import { GoogleGenAI, Modality } from '@google/genai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logDebug, logError } from '@/lib/app-log';

// ── Brand style system ───────────────────────────────────────────────────────

import { getBrandStyle, type BrandStyle } from './brand-style';

// ── Persona system ───────────────────────────────────────────────────────────

import { PERSONAS_BY_BRAND, type PersonaId, type PersonaDef } from './persona-data';
export type { PersonaId };

import { resolveScene, sceneClause } from './creative-scene';
import { isUsableImageResponse, personaAssetOrigin, personaAssetUrl } from './persona-asset';
import {
  constructionFidelityLine,
  detectGarmentTraits,
  openingGuardLine,
  patternFidelityLine,
  type GarmentTraits,
} from './garment-traits';

function getPersona(brand: string, personaId: string): PersonaDef | undefined {
  return PERSONAS_BY_BRAND[brand]?.find(p => p.id === personaId);
}

/**
 * The persona photograph, as bytes ready to attach.
 *
 * This was a bare read of `public/<imageUrl>` from the working directory. That
 * resolves on a developer machine and fails on Vercel, where `public/` is
 * served by the CDN and is not part of the serverless bundle — and the path is
 * built from a variable, so file tracing cannot pull it in either. The read
 * failed, the error was logged, and generation carried on regardless while the
 * prompt still instructed Gemini to copy "the model from Image A". Nothing was
 * attached under that label, so it invented a model, and every later reference
 * to Image B pointed one slot away from the image actually sent.
 *
 * Disk first, so local development keeps working offline. HTTP second, so
 * production works at all. Null is the honest third answer, and the caller must
 * then build a prompt that never mentions a model reference.
 */
async function loadPersonaImage(
  persona: PersonaDef | undefined,
): Promise<{ base64: string; mimeType: string } | null> {
  const url = persona?.imageUrl;
  if (!url) return null;

  const mimeByExtension = url.endsWith('.png')
    ? 'image/png'
    : url.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';

  try {
    const diskPath = path.join(process.cwd(), 'public', url);
    if (fs.existsSync(diskPath)) {
      return { base64: fs.readFileSync(diskPath).toString('base64'), mimeType: mimeByExtension };
    }
  } catch (e) {
    logError('CreativeGen', `Persona image unreadable on disk: ${url}`, e);
  }

  const base = personaAssetOrigin();
  if (!base) {
    logError(
      'CreativeGen',
      `Persona image ${url} is not on disk and no base URL is available — generating without a model reference.`,
    );
    return null;
  }

  try {
    const res = await fetch(personaAssetUrl(base, url));
    const contentType = res.headers.get('content-type');

    // A 200 is not proof. /personas used to sit behind auth, so this fetch
    // followed a redirect to /login and came back as an 11KB HTML page with
    // status 200 — which was then sent to Gemini labelled as a PNG.
    if (!isUsableImageResponse(res.status, contentType)) {
      logError(
        'CreativeGen',
        `Persona image ${url} did not return an image (HTTP ${res.status}, ${contentType ?? 'no content-type'}) — ` +
        `generating without a model reference.`,
      );
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      base64: buffer.toString('base64'),
      mimeType: contentType ?? mimeByExtension,
    };
  } catch (e) {
    logError('CreativeGen', `Persona image fetch threw for ${url}`, e);
    return null;
  }
}

// ── Models ───────────────────────────────────────────────────────────────────

// Accepts image input AND generates image output via generateContent.
// This enables the virtual try-on path (product photo → model wearing it).
// Google now labels gemini-2.5-flash-image legacy; override to move off it
// without a code change once the cost/quality trade-off has been checked.
const IMAGE_EDIT_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const HIGH_ACCURACY_IMAGE_MODEL =
  process.env.GEMINI_HIGH_ACCURACY_IMAGE_MODEL || 'gemini-3-pro-image';

// Text-to-image only — used when no source image is provided.
const TEXT_TO_IMAGE_MODEL = 'gemini-3.1-flash-image';

// ── Interfaces ───────────────────────────────────────────────────────────────

export type ViewAngle = 'front' | 'side' | 'back' | 'closeup';
export type CreativeGenerationQuality = 'standard' | 'high_accuracy';

// Instagram feed crops anything narrower than 4:5, so that is the default.
export type CreativeAspectRatio = '4:5' | '1:1' | '4:3' | '9:16';
export const DEFAULT_ASPECT_RATIO: CreativeAspectRatio = '4:5';

// A real photograph of the garment from one angle. Supplying the angle the user
// asked for is what keeps generation faithful — anything not photographed has
// to be invented by the model.
export interface ReferenceImage {
  base64: string;
  mimeType: string;
  angle: ViewAngle;
}

export interface CreativeGenerationInput {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  garmentFitNotes?: string;
  referenceImages?: ReferenceImage[];
  // Legacy single-image entry point — treated as a front reference.
  sourceImageBase64?: string;
  sourceImageMimeType?: string;
  viewAngle?: ViewAngle;
  quality?: CreativeGenerationQuality;
  aspectRatio?: CreativeAspectRatio;
  poseInstruction?: string;
  // Free-form correction notes appended to the prompt as final user instructions.
  // Used by per-tile regenerate to fix specific issues (e.g. "no buttons on back").
  // Every past correction is replayed so a new one never undoes an earlier fix.
  corrections?: string[];
  // Identifies the product, never the angle. Front, side and back must resolve
  // to the same companion clothing and location, including when one tile is
  // regenerated on its own long after the others. Falls back to productContext.
  sceneKey?: string;
}

const ANGLE_NOUN: Record<ViewAngle, string> = {
  front: 'FRONT',
  side: 'SIDE',
  back: 'BACK',
  closeup: 'DETAIL',
};

interface ResolvedReferences {
  primary?: ReferenceImage;
  supporting: ReferenceImage[];
  // True when the requested angle is backed by a real photo instead of inferred.
  grounded: boolean;
}

function resolveReferences(input: CreativeGenerationInput): ResolvedReferences {
  const provided = input.referenceImages?.length
    ? input.referenceImages
    : input.sourceImageBase64 && input.sourceImageMimeType
      ? [{
          base64: input.sourceImageBase64,
          mimeType: input.sourceImageMimeType,
          angle: 'front' as ViewAngle,
        }]
      : [];

  // One reference per angle — later duplicates for the same angle are ignored.
  const byAngle = new Map<ViewAngle, ReferenceImage>();
  for (const ref of provided) {
    if (!byAngle.has(ref.angle)) byAngle.set(ref.angle, ref);
  }

  const requested = input.viewAngle ?? 'front';
  const exact = byAngle.get(requested);
  // A close-up is a crop of the front surface, so a front photo grounds it just
  // as well. Back and side show surfaces a front photo never captured.
  const closeupFallback = requested === 'closeup' ? byAngle.get('front') : undefined;

  const primary = exact ?? closeupFallback ?? byAngle.get('front') ?? provided[0];
  const supporting = [...byAngle.values()].filter(ref => ref !== primary);

  return { primary, supporting, grounded: Boolean(exact ?? closeupFallback) };
}

// Camera + composition guidance per view angle.
function viewAngleClause(angle: ViewAngle | undefined): string {
  switch (angle) {
    case 'side':
      return 'Camera angle: side/profile view of the model, approximately 80-100 degrees. The model may be standing, mid-step, or lightly turning, but the side silhouette must remain clear. Keep any front floral/graphic artwork anchored on the garment front panel near the model-facing/front edge. Do not center the artwork on the side seam, underarm, or side torso.';
    case 'back':
      return 'Camera angle: rear view of the model facing mostly away from camera, approximately 160-180 degrees. The model may glance slightly over shoulder or shift weight, but the back of the garment must remain the hero. Showcase the back neckline, sleeve shape, stripe continuation, and hemline. Keep the back plain if the source garment appears plain: no added vertical seam lines, black contour lines, darts, piping, or panels.';
    case 'closeup':
      return 'Camera angle: tight close-up on the garment fabric, print, buttons, stitching, and construction details. Half-body crop, sharp focus on the exact source garment texture.';
    case 'front':
    default:
      return 'Camera angle: front-facing or slight three-quarter full-body shot of the model. The model may walk toward camera, shift weight, place one hand at waist, lightly raise one hand, or hold a relaxed natural fashion pose, but the garment front must remain fully visible and match the source image exactly.';
  }
}

function poseVariationClause(angle: ViewAngle | undefined, poseInstruction?: string): string {
  const defaultByAngle: Record<ViewAngle, string[]> = {
    front: [
      'model walking slowly toward camera with relaxed arms',
      'model standing with one hand lightly raised near hair',
      'model shifting weight with one hand at waist and the other relaxed',
      'model taking a small forward step, natural candid expression',
      'model standing straight with one arm softly bent',
    ],
    side: [
      'model in a gentle mid-step profile pose',
      'model standing side-on with one hand relaxed near hip',
      'model lightly turning head forward while body remains side profile',
      'model walking past camera in a clean profile silhouette',
    ],
    back: [
      'model walking away from camera with natural arm movement',
      'model standing with weight shifted, looking slightly over shoulder',
      'model facing away with one hand lightly touching hair',
      'model taking a small step forward away from camera',
    ],
    closeup: [
      'natural half-body close-up with one hand near the garment edge',
      'close-up crop with relaxed hand showing fabric scale',
      'editorial close-up focused on print, texture, and construction',
    ],
  };
  const options = defaultByAngle[angle ?? 'front'];
  const selected = poseInstruction?.trim() || options[Math.floor(Math.random() * options.length)];

  return (
    `MODEL POSE VARIATION:\n` +
    `- Use this natural pose direction: ${selected}.\n` +
    `- Keep the requested camera/view angle accurate. Pose variation must never hide, crop away, distort, recolor, or redesign the garment.\n` +
    `- Avoid repeating the exact same stiff catalog stance across generated images; make the pose feel like a real fashion shoot.`
  );
}

// When the requested angle is backed by a real photo there is nothing to infer,
// so the model gets a short "reproduce what you see" instruction instead of the
// long list of invented details it must avoid. Fewer, non-contradictory rules
// produce more faithful output than a wall of prohibitions.
function groundedAccuracyClause(viewAngle: ViewAngle | undefined, hasSupporting: boolean, traits: GarmentTraits): string {
  const angle = ANGLE_NOUN[viewAngle ?? 'front'];
  const supportingLine = hasSupporting
    ? `- The additional reference images show the same garment from other angles. Use them to stay consistent where Image B is unclear, and never contradict them.\n`
    : `- Where Image B leaves a region unclear, keep it simple and consistent with what is visible. Never invent a detail no reference shows.\n`;

  return (
    `GARMENT FIDELITY - HIGHEST PRIORITY:\n` +
    `- Image B is a real photograph of the ${angle} of the exact garment to render. Reproduce what it shows; do not redesign, recolour, or re-interpret it.\n` +
    `${constructionFidelityLine(traits)}\n` +
    `${patternFidelityLine(traits)}\n` +
    `${openingGuardLine(traits)}\n` +
    supportingLine +
    `- Preserve the exact base colour and hue under realistic lighting. Brand palette, golden-hour sunlight, shadows, and colour grading must never shift the garment into a different colour family.\n` +
    `- Fit the garment onto the model naturally with realistic drape, folds, and shadows. Only the model pose, background, and companion clothing may change.`
  );
}

function inferredAccuracyClause(viewAngle: ViewAngle | undefined, traits: GarmentTraits): string {
  const angleSpecific = viewAngle === 'back'
    ? '- For the back view, infer only the hidden back shape from the same garment. Keep color, fabric, sleeve shape, neckline style, and hem shape consistent; do not transplant front-only decoration to the back. Do not add vertical black back contour lines, princess seams, darts, piping, or panel lines unless Image B clearly shows them.\n'
    : viewAngle === 'side'
      // The old version put "the floral/graphic artwork on the front-left panel"
      // and closed the side seam unconditionally. On a wrap that is an
      // instruction to delete the design.
      ? `- For the side view, keep any placed artwork on the same panel and at the same height from the hem as the source; never slide it to the centre of the side panel.\n${openingGuardLine(traits)}\n`
      : viewAngle === 'front'
        ? (traits.hasSleeves
            ? '- For the front view, duplicate the source neckline exactly. If the source neckline is a smooth continuous round/scoop neck, keep it smooth and continuous: no V slit, notch, keyhole, vertical opening, collar, tie, zipper, or extra cutout at the center front.\n'
            : '- For the front view, duplicate the source waistband and hem exactly: no added seams, panels, bands, or openings the reference does not show.\n'
          ) + `${openingGuardLine(traits)}\n`
        : '';

  return (
    `GARMENT FIDELITY - HIGHEST PRIORITY:\n` +
    `- Before rendering, inspect Image B and mentally lock the garment blueprint: neckline shape, side seams/openings, back seams, stripe sequence, sleeve cuff/hem color, artwork placement, hem curve, and fabric color.\n` +
    `- Treat Image B as a product reference that must be duplicated, not re-designed or re-colored.\n` +
    `- The output garment must be the same SKU/product as Image B. A different color, darker/lighter color family, alternate neckline, different sleeve roll, different hem, changed button line, or moved floral/graphic placement is a failed result.\n` +
    `${constructionFidelityLine(traits)}\n` +
    `${patternFidelityLine(traits)}\n` +
    `${openingGuardLine(traits)}\n` +
    `- Preserve the exact base colour and hue from Image B under realistic lighting. Brand palette, warm sunlight, shadows and colour grading must never shift the garment into another colour family.\n` +
    `- Do not add, remove, mirror, relocate, resize, recolour, or simplify any seam, fastening, trim, or decoration.\n` +
    angleSpecific +
    `- Fit the exact garment onto the model naturally; only the model pose, background, and companion clothing may change.`
  );
}

function garmentAccuracyClause(viewAngle: ViewAngle | undefined, grounded: boolean, hasSupporting: boolean, traits: GarmentTraits): string {
  return grounded
    ? groundedAccuracyClause(viewAngle, hasSupporting, traits)
    : inferredAccuracyClause(viewAngle, traits);
}

function hardRejectClause(garmentFitNotes: string | undefined, grounded: boolean, traits: GarmentTraits): string {
  // Never on a wrap: that garment's whole point is an opening, and the product
  // text describing it ("not a cut side slit") reads as a request to seal it.
  const noSideSlit = !traits.isWrap && garmentFitNotes?.toLowerCase().includes('no side slit')
    ? '- The user explicitly says "no side slit": the rendered garment must have fully closed side seams with no leg/skin visible through the side.\n'
    : '';

  // With a real photo of this angle, a direct comparison catches errors better
  // than enumerating the specific artefacts inference tends to produce.
  if (grounded) {
    return (
      `FINAL SELF-CHECK BEFORE OUTPUT:\n` +
      noSideSlit +
      `- Compare the rendered garment against Image B point by point:\n` +
      `${constructionFidelityLine(traits)}\n` +
      `${patternFidelityLine(traits)}\n` +
      `${openingGuardLine(traits)}\n` +
      `- Remove any seam, panel line, band, or trim you added that no reference image shows.\n` +
      `If anything differs from Image B, fix it before returning the image.`
    );
  }

  return (
    `FINAL SELF-CHECK BEFORE OUTPUT - REJECT AND FIX IF PRESENT:\n` +
    noSideSlit +
    `- No side slit, open side panel, wrap opening, vent, or exposed leg at the side unless the input text explicitly asks for one.\n` +
    `- No black sleeve cuffs, no black sleeve hems, no black sleeve edge bands.\n` +
    `- No thick black dress bottom hem or black bottom border; keep bottom hem/stripes exactly as Image B.\n` +
    `- No added vertical black back lines, piping, princess seams, darts, or contour panels.\n` +
    `- No red-to-white color shift: red bands must remain dominant red bands with the same stripe order as Image B.\n` +
    `If any of these forbidden artifacts appear, remove them before returning the image.`
  );
}

function fitCalibrationClause(persona: PersonaDef | undefined, garmentFitNotes: string | undefined): string {
  const modelHeight = persona?.height
    ? `- Model height reference: ${persona.height}. Use this to scale garment length and sleeve length on the body.\n`
    : '';
  const fitNotes = garmentFitNotes?.trim()
    ? `- Garment fit/measurement reference: ${garmentFitNotes.trim()}.\n`
    : '- If no exact garment measurement is provided, estimate the garment length and sleeve length from Image B and preserve those proportions on the model.\n';

  return (
    `FIT AND LENGTH CALIBRATION:\n` +
    modelHeight +
    fitNotes +
    `- Garment length on the model must follow the source garment proportions. Do not shorten a knee-length dress into a mini dress or lengthen it beyond the source proportions.\n` +
    `- Use measurements only to scale the garment; measurements must not override visible source details such as stripes, side seams, sleeve cuffs, neckline, or hem color.`
  );
}

// Instruct the model to complete the outfit when the source garment covers
// only one half of the body. Gemini infers the garment type from the source image.
// Outfit completion used to live here as a single sentence — "add a simple,
// neutral matching top". Each angle is its own call, so each call answered it
// differently and a three-angle set came back as three different outfits in
// three different places. It now comes from creative-scene.ts, which resolves
// one answer per product. See sceneClause().

export interface CreativeGenerationResult {
  imageData: string; // data URL: data:<mimeType>;base64,<data>
  mimeType: string;
  prompt: string;
  // False when the requested angle had no photo and had to be inferred — the
  // UI surfaces this so the user knows which tiles need the closest review.
  grounded: boolean;
}

type GeminiContentPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } };

// ── Prompt builders ──────────────────────────────────────────────────────────

interface PromptOptions {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  style: BrandStyle;
  viewAngle?: ViewAngle;
  garmentFitNotes?: string;
  poseInstruction?: string;
  corrections?: string[];
  // Whether the requested angle is backed by a real photo.
  grounded: boolean;
  hasSupporting: boolean;
  hasPersonaImage?: boolean;
  // Companion clothing and location, already resolved so every angle matches.
  scene: string;
}

// Every past correction is replayed, so fixing one issue never silently undoes
// a fix the user asked for earlier.
function correctionClause(corrections: string[] | undefined): string {
  const notes = corrections?.map(note => note.trim()).filter(Boolean) ?? [];
  if (notes.length === 0) return '';

  return (
    `\n\nUSER CORRECTIONS (highest priority — every one must hold in the new image):\n` +
    notes.map((note, index) => `${index + 1}. ${note}`).join('\n')
  );
}

// Describes the reference images supplied after the prompt, so the labels in the
// prompt line up with the parts actually sent.
function referenceManifest(
  primaryAngle: ViewAngle,
  supportingAngles: ViewAngle[],
  hasPersonaImage: boolean,
): string {
  const lines: string[] = [];
  if (hasPersonaImage) {
    lines.push(`[IMAGE A — THE MODEL]: photo of the model. Use her EXACT face, skin tone, hair, and body.`);
  }
  lines.push(
    `[IMAGE B — THE GARMENT, ${ANGLE_NOUN[primaryAngle]} VIEW]: the garment to render, photographed from the angle you must produce. ` +
    `Use ONLY the clothing from this image — completely ignore any person wearing it.`,
  );
  supportingAngles.forEach((angle, index) => {
    lines.push(
      `[IMAGE ${String.fromCharCode(67 + index)} — SAME GARMENT, ${ANGLE_NOUN[angle]} VIEW]: the same physical garment from another angle. ` +
      `Use it for construction consistency only; do not copy its camera angle.`,
    );
  });
  return lines.join('\n');
}

function buildTryOnPrompt(o: PromptOptions, supportingAngles: ViewAngle[]): string {
  const {
    brand, personaId, productContext, style, viewAngle,
    garmentFitNotes, poseInstruction, corrections, grounded, hasSupporting, scene,
  } = o;
  const traits = detectGarmentTraits(`${productContext} ${garmentFitNotes ?? ''}`);
  const correctionLine = correctionClause(corrections);
  const persona = getPersona(brand, personaId);
  const primaryAngle = viewAngle ?? 'front';

  // If we have a persona image, we use a multi-image workflow with explicit labels
  if (persona && persona.id !== 'none' && o.hasPersonaImage) {
    return (
      `You are a world-class fashion photographer creating a virtual try-on. ` +
      `I am providing these reference images:\n` +
      `${referenceManifest(primaryAngle, supportingAngles, true)}\n\n` +
      `YOUR TASK: Generate a brand-new, high-quality fashion photograph of the MODEL from Image A wearing the GARMENT from Image B.\n\n` +
      `CRITICAL — MODEL IDENTITY:\n` +
      `- The person in the output MUST be the model from Image A. Same face, same hair, same skin tone (${persona.skinTone}).\n` +
      `- If Image B shows a different person wearing the garment, IGNORE that person completely. Only use Image B for the garment design.\n` +
      `- Model height: ${persona.height}. Body type: ${persona.bodyShape}.\n\n` +
      `${garmentAccuracyClause(viewAngle, grounded, hasSupporting, traits)}\n` +
      `${fitCalibrationClause(persona, garmentFitNotes)}\n` +
      `${poseVariationClause(viewAngle, poseInstruction)}\n` +
      `- The garment must drape naturally on the model's body with realistic folds and shadows.\n` +
      (productContext.trim() ? `- Garment details: ${productContext.trim()}.\n` : '') +
      `\n${scene}\n` +
      `\nPHOTOGRAPHY — MAKE IT LOOK 100% REAL:\n` +
      `- Shot on Canon EOS R5, 85mm f/1.4 lens. Shallow depth of field with creamy bokeh.\n` +
      `- Natural skin texture: visible pores, subtle skin imperfections, realistic subsurface scattering on skin.\n` +
      `- Slight natural wind movement in hair and fabric for a candid, lived-in feel.\n` +
      `- Aesthetic: ${style.aesthetic}. Keep the location and light exactly as specified above.\n` +
      `- Realistic catch-lights in the model's eyes. Colour-grade the skin and scene only. The garment keeps the hue it has in Image B: warm light must not push a cool or muted colour toward golden, tan, or orange.\n` +
      `- Subtle film grain for an authentic editorial feel. NOT overly smooth or airbrushed.\n` +
      `- ${viewAngleClause(viewAngle)}\n` +
      `- Style: Premium ${brand} brand campaign. ${style.mood}.\n` +
      `${hardRejectClause(garmentFitNotes, grounded, traits)}\n` +
      `- Absolutely NO text, logos, or watermarks.` +
      correctionLine
    );
  }

  // Fallback: no persona, product-only shot
  const contextNote = productContext.trim()
    ? ` The garment is described as: ${productContext.trim()}.` : '';

  return (
    `Generate a professional fashion marketing photo showing the exact source garment in a premium setting.\n\n` +
    `${referenceManifest(primaryAngle, supportingAngles, false)}\n\n` +
    `${garmentAccuracyClause(viewAngle, grounded, hasSupporting, traits)}\n\n` +
    `${fitCalibrationClause(persona, garmentFitNotes)}\n\n` +
    `${poseVariationClause(viewAngle, poseInstruction)}\n\n` +
    `${scene}\n` +
    `${contextNote} ` +
    `Brand: ${brand}. Visual style: ${style.aesthetic}. Mood: ${style.mood}. ` +
    `High-end editorial composition. Sharp focus, beautiful lighting. ` +
    `${hardRejectClause(garmentFitNotes, grounded, traits)} ` +
    `No text, logos, or watermarks.` +
    correctionLine
  );
}

function buildTextToImagePrompt(o: PromptOptions): string {
  const {
    brand, personaId, productContext, style, viewAngle,
    garmentFitNotes, poseInstruction, corrections, grounded,
  } = o;
  const correctionLine = correctionClause(corrections);
  const persona = getPersona(brand, personaId);
  const garment = productContext.trim() || 'a fashion garment';
  const traits = detectGarmentTraits(`${productContext} ${garmentFitNotes ?? ''}`);

  let subjectClause = `clean flat-lay of: ${garment}`;
  let physicalAttributes = '';

  if (persona && persona.id !== 'none') {
    subjectClause = `a female model wearing: ${garment}`;
    physicalAttributes = `CRITICAL IDENTITY & PHYSICAL ATTRIBUTES: The model's face, identity, and facial features MUST be an exact match to the provided persona reference image. Height is exactly ${persona.height}. Body shape is ${persona.bodyShape}. Skin tone is ${persona.skinTone}. Maintain these exact facial features, proportions, and skin tone. Ensure the garment length properly reflects a model of ${persona.height}. Do not deviate from these identity or physical traits. `;
  }

  return (
    `Professional fashion marketing photograph for ${brand}, a Sri Lankan women's fashion brand. ` +
    `Subject: ${subjectClause}. ` +
    `${physicalAttributes}` +
    `${fitCalibrationClause(persona, garmentFitNotes)} ` +
    `${poseVariationClause(viewAngle, poseInstruction)} ` +
    `Visual aesthetic: ${style.aesthetic}. Color palette: ${style.colorPalette}. Mood: ${style.mood}. ` +
    `${viewAngleClause(viewAngle)} The garment is the hero — all key design details clearly visible. ` +
    `Professional studio or natural fashion lighting. Sharp focus on the outfit. ` +
    `${hardRejectClause(garmentFitNotes, grounded, traits)} ` +
    `Post-ready social media marketing composition. No text, logos, or watermarks.` +
    correctionLine
  );
}

// ── Generator ────────────────────────────────────────────────────────────────

export async function generateCreative(
  input: CreativeGenerationInput,
): Promise<CreativeGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const style = getBrandStyle(input.brand);
  const aspectRatio = input.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const { primary, supporting, grounded } = resolveReferences(input);

  // ── Path A: image-in → image-out (virtual try-on) ────────────────────────
  // The image-edit model accepts the product photos and generates a new image
  // of a model wearing exactly that garment.

  if (primary) {
    const selectedPersona = getPersona(input.brand, input.personaId);

    // Loaded before the prompt is written, not after. The prompt describes the
    // images it is sent with, so it must not be able to promise a model
    // reference that never arrives.
    const personaImage = await loadPersonaImage(selectedPersona);
    const hasPersonaImage = !!personaImage;

    const scene = resolveScene(
      input.sceneKey?.trim() || input.productContext,
      `${input.productContext} ${input.garmentFitNotes ?? ''}`,
    );
    const imageModel = input.quality === 'high_accuracy' ? HIGH_ACCURACY_IMAGE_MODEL : IMAGE_EDIT_MODEL;
    const supportingAngles = supporting.map(ref => ref.angle);
    const prompt = buildTryOnPrompt({
      brand: input.brand,
      personaId: input.personaId,
      productContext: input.productContext,
      style,
      viewAngle: input.viewAngle,
      garmentFitNotes: input.garmentFitNotes,
      poseInstruction: input.poseInstruction,
      corrections: input.corrections,
      grounded,
      hasSupporting: supporting.length > 0,
      hasPersonaImage,
      scene: sceneClause(scene),
    }, supportingAngles);

    logDebug(
      'CreativeGen',
      `Try-on generation via ${imageModel} — brand "${input.brand}" persona "${input.personaId}" ` +
      `angle "${input.viewAngle ?? 'front'}" (${grounded ? 'photo-grounded' : 'inferred'}), ` +
      `${supporting.length} supporting reference(s).`,
    );

    // Parts order: [prompt] -> [Image A: persona/model] -> [Image B: primary
    // garment reference] -> [Image C..: same garment, other angles].
    // Persona goes FIRST so the AI anchors on the model's identity before seeing the garment.
    const parts: GeminiContentPart[] = [
      { text: prompt },
    ];

    // Image A — MODEL (persona reference) — goes first to anchor identity.
    // Already loaded, and the prompt above was written knowing whether it
    // exists, so the labels here cannot drift out of step with the prompt.
    if (personaImage) {
      parts.push({
        text: 'IMAGE A - MODEL REFERENCE. Use only this person for face, body, hair, and skin tone.',
      });
      parts.push({
        inlineData: { data: personaImage.base64, mimeType: personaImage.mimeType },
      });
      logDebug('CreativeGen', `[Image A — MODEL] persona "${input.personaId}" attached`);
    } else if (selectedPersona?.imageUrl) {
      logError(
        'CreativeGen',
        `Persona "${input.personaId}" has image ${selectedPersona.imageUrl} but it could not be loaded — ` +
        `generating with the persona's written description only.`,
      );
    }

    // Image B — GARMENT, photographed from the angle being generated
    const primaryAngleNoun = ANGLE_NOUN[primary.angle];
    parts.push({
      // Keyed off the bytes, not the URL. Referring to "the Image A model" when
      // no Image A was attached is what set the model adrift.
      text: personaImage
        ? `IMAGE B - GARMENT PRODUCT REFERENCE (${primaryAngleNoun} VIEW). Duplicate this garment exactly on the Image A model.`
        : `IMAGE B - GARMENT PRODUCT REFERENCE (${primaryAngleNoun} VIEW). Generate this exact garment/product without changing design or color.`,
    });
    parts.push({
      inlineData: { data: primary.base64, mimeType: primary.mimeType },
    });

    // Image C onward — the same garment from other angles. These resolve
    // construction details the primary photo cannot show, so the model no
    // longer has to invent a back or side it has never seen.
    supporting.forEach((ref, index) => {
      parts.push({
        text: `IMAGE ${String.fromCharCode(67 + index)} - SAME GARMENT, ${ANGLE_NOUN[ref.angle]} VIEW. ` +
          `Use for construction, colour, and trim consistency only. Do not reproduce this camera angle.`,
      });
      parts.push({
        inlineData: { data: ref.base64, mimeType: ref.mimeType },
      });
    });
    logDebug(
      'CreativeGen',
      `[Image B — GARMENT ${primaryAngleNoun}] plus ${supporting.length} supporting angle(s): ` +
      `${supporting.map(ref => ref.angle).join(', ') || 'none'}.`,
    );

    const response = await ai.models.generateContent({
      model: imageModel,
      contents: [{
        role: 'user',
        parts,
      }],
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
        imageConfig: { aspectRatio, imageSize: '1K' },
      },
    });

    const candidates = response.candidates ?? [];
    for (const candidate of candidates) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData?.mimeType) {
          const mimeType = part.inlineData.mimeType;
          const imageData = `data:${mimeType};base64,${part.inlineData.data}`;
          logDebug('CreativeGen', 'Try-on creative generated successfully.');
          return { imageData, mimeType, prompt, grounded };
        }
      }
    }

    // If the model returned text instead of an image (e.g. safety refusal), surface it
    const textPart = candidates[0]?.content?.parts?.find(p => p.text);
    const reason = textPart?.text ?? candidates[0]?.finishReason ?? 'unknown';
    logError('CreativeGen', `${imageModel} returned no image.`, { reason });
    throw new Error(
      `Image generation was blocked or returned no output. Reason: ${reason}. ` +
      `Try rephrasing the product description or using a different product image.`,
    );
  }

  // ── Path B: text-to-image (no source photo) ──────────────────────────────
  // Gemini native image models use generateContent. generateImages targets the
  // legacy predict endpoint and is only supported by Imagen models.

  const prompt = buildTextToImagePrompt({
    brand: input.brand,
    personaId: input.personaId,
    productContext: input.productContext,
    style,
    viewAngle: input.viewAngle,
    garmentFitNotes: input.garmentFitNotes,
    poseInstruction: input.poseInstruction,
    corrections: input.corrections,
    scene: sceneClause(
      resolveScene(
        input.sceneKey?.trim() || input.productContext,
        `${input.productContext} ${input.garmentFitNotes ?? ''}`,
      ),
    ),
    // Nothing was photographed, so every detail is inferred.
    grounded: false,
    hasSupporting: false,
  });

  logDebug('CreativeGen', `Text-to-image via ${TEXT_TO_IMAGE_MODEL} — brand "${input.brand}" persona "${input.personaId}".`);

  const response = await ai.models.generateContent({
    model: TEXT_TO_IMAGE_MODEL,
    contents: prompt,
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: {
        aspectRatio,
        imageSize: '1K',
      },
    },
  });

  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        const mimeType = part.inlineData.mimeType;
        const imageData = `data:${mimeType};base64,${part.inlineData.data}`;
        logDebug('CreativeGen', 'Text-to-image creative generated successfully.');
        return { imageData, mimeType, prompt, grounded: false };
      }
    }
  }

  const textPart = candidates[0]?.content?.parts?.find(part => part.text);
  const reason = textPart?.text ?? candidates[0]?.finishReason ?? 'unknown';
  logError('CreativeGen', `${TEXT_TO_IMAGE_MODEL} returned no image.`, { reason });
  throw new Error(
    `Image generation was blocked or returned no output. Reason: ${reason}. ` +
    'Try rephrasing the product description.',
  );
}
