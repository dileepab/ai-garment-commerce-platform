import { GoogleGenAI, Modality } from '@google/genai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logDebug, logError, logInfo, logWarn } from './app-log';

// ── Brand style system ───────────────────────────────────────────────────────

import { getBrandStyle, type BrandStyle } from './brand-style';

// ── Persona system ───────────────────────────────────────────────────────────

import { findPersonaForBrand, type PersonaId, type PersonaDef } from './persona-data';
export type { PersonaId };

import { resolveScene, sceneClause } from './creative-scene';
import {
  isUsableImageResponse,
  personaAssetOrigin,
  personaAssetUrl,
  sniffImageMimeType,
} from './persona-asset';
import {
  constructionFidelityLine,
  detectGarmentTraits,
  openingGuardLine,
  patternFidelityLine,
  silhouetteFidelityLine,
  type GarmentTraits,
} from './garment-traits';
import { createPersonaIdentityReference } from './persona-reference';
import {
  buildFidelityRetryCorrection,
  fidelityFingerprint,
  reviewCreativeFidelity,
} from './creative-fidelity';

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

  try {
    const diskPath = path.join(process.cwd(), 'public', url);
    if (fs.existsSync(diskPath)) {
      const buffer = fs.readFileSync(diskPath);
      const mimeType = sniffImageMimeType(buffer);
      if (!mimeType) {
        logError('CreativeGen', `Persona file ${url} on disk is not an image — skipping it.`);
        return null;
      }
      return { base64: buffer.toString('base64'), mimeType };
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

    // Neither the filename nor the served content-type can be trusted: every
    // persona .png is really a JPEG, so both say image/png over JFIF data.
    const mimeType = sniffImageMimeType(buffer);
    if (!mimeType) {
      logError(
        'CreativeGen',
        `Persona image ${url} returned ${contentType ?? 'no content-type'} but the bytes are not an image — ` +
        `generating without a model reference.`,
      );
      return null;
    }

    return { base64: buffer.toString('base64'), mimeType };
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
function viewAngleClause(angle: ViewAngle | undefined, traits: GarmentTraits): string {
  const fullBottomFrame = traits.isBottom
    ? ' Frame the entire model from the top of the head through both feet. Keep both hems and both feet fully visible, with small headroom and visible floor below the feet; zoom out as needed and never crop the garment or feet.'
    : '';

  switch (angle) {
    case 'side':
      return 'Camera angle: side/profile view of the model, approximately 80-100 degrees. The side silhouette must remain clear. Keep any front floral/graphic artwork anchored on the garment front panel near the model-facing/front edge. Do not center the artwork on the side seam, underarm, or side torso.' + fullBottomFrame;
    case 'back':
      if (traits.isBottom) {
        return 'Camera angle: straight rear view of the model facing away from camera, approximately 170-180 degrees. Use a stable standing pose with both legs extended so the full back waistband, seat, two leg lines, hem widths and length remain unobstructed. Match the exact back elastic, seams, pockets or absence of pockets, and belt loops or absence of loops shown by the back reference.' + fullBottomFrame;
      }
      return 'Camera angle: rear view of the model facing mostly away from camera, approximately 160-180 degrees. The model may glance slightly over shoulder or shift weight, but the back of the garment must remain the hero. Showcase the back neckline, sleeve shape, stripe continuation, and hemline. Keep the back plain if the source garment appears plain: no added vertical seam lines, black contour lines, darts, piping, or panels.';
    case 'closeup':
      return 'Camera angle: tight close-up on the garment fabric, print, buttons, stitching, and construction details. Half-body crop, sharp focus on the exact source garment texture.';
    case 'front':
    default:
      if (traits.isBottom) {
        return 'Camera angle: straight front-facing full-body fashion shot. Use a stable standing pose with both legs extended and uncrossed so the complete waistband, pockets, pleats, two leg lines, hem widths and length remain visible and directly comparable to the front reference.' + fullBottomFrame;
      }
      return 'Camera angle: front-facing or slight three-quarter full-body shot of the model. The model may walk toward camera, shift weight, place one hand at waist, lightly raise one hand, or hold a relaxed natural fashion pose, but the garment front must remain fully visible and match the source image exactly.';
  }
}

function poseVariationClause(angle: ViewAngle | undefined, poseInstruction: string | undefined, traits: GarmentTraits): string {
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
  const bottomByAngle: Record<ViewAngle, string[]> = {
    front: [
      'model standing straight with both legs extended and feet naturally apart',
      'model in a relaxed symmetrical stance with both trouser legs fully visible',
      'model standing with a slight weight shift that does not bend, cross or hide either leg',
    ],
    side: [
      'model standing in a clean side profile with both feet on the ground',
      'model holding a relaxed static side-profile pose that keeps the full hem visible',
    ],
    back: [
      'model standing straight facing away with both legs extended and feet naturally apart',
      'model in a relaxed symmetrical rear stance with the full waistband and both hems visible',
    ],
    closeup: defaultByAngle.closeup,
  };
  const options = traits.isBottom ? bottomByAngle[angle ?? 'front'] : defaultByAngle[angle ?? 'front'];
  const selected = poseInstruction?.trim() || options[Math.floor(Math.random() * options.length)];
  const bottomGuard = traits.isBottom && angle !== 'closeup'
    ? '- Do not use a walking, crossed-leg, seated, crouched or sharply bent-knee pose; it hides and distorts the leg width, hem and true garment length.\n'
    : '';

  return (
    `MODEL POSE VARIATION:\n` +
    `- Use this natural pose direction: ${selected}.\n` +
    bottomGuard +
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
    `${silhouetteFidelityLine(traits)}\n` +
    `${patternFidelityLine(traits)}\n` +
    `${openingGuardLine(traits)}\n` +
    supportingLine +
    `- Preserve the exact base colour, lightness, saturation and hue under realistic lighting. White-balance the garment against Image B: scene light, shadows and colour grading must never warm, darken, yellow or shift it into a different colour family.\n` +
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
    `${silhouetteFidelityLine(traits)}\n` +
    `${patternFidelityLine(traits)}\n` +
    `${openingGuardLine(traits)}\n` +
    `- Preserve the exact base colour, lightness, saturation and hue from Image B under realistic lighting. White-balance the garment against Image B: scene light, shadows and colour grading must never warm, darken, yellow or shift it into another colour family.\n` +
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
      `${silhouetteFidelityLine(traits)}\n` +
      `${patternFidelityLine(traits)}\n` +
      `${openingGuardLine(traits)}\n` +
      `- Re-check every explicit product rule above, especially any required presence or absence of zips, flies, buttons, plackets, belt loops, pockets, elastic, pleats, seams and panels.\n` +
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

function productSpecificRulesClause(garmentFitNotes: string | undefined): string {
  const notes = garmentFitNotes?.trim();
  if (!notes) return '';
  return (
    `PRODUCT-SPECIFIC CONSTRUCTION AND FIT RULES - HIGHEST PRIORITY:\n` +
    `${notes}\n` +
    `- Treat every explicit presence or absence as mandatory. Generic fashion conventions must never add a fly, ` +
    `zipper, button, placket, belt loop, pocket, dart, pleat, seam or panel that these rules or the references do not show.\n`
  );
}

function fitCalibrationClause(persona: PersonaDef | undefined, garmentFitNotes: string | undefined): string {
  const modelHeight = persona?.height
    ? `- Model height reference: ${persona.height}. Use this to scale garment length and sleeve length on the body.\n`
    : '';
  const fitNotes = garmentFitNotes?.trim()
    ? '- Apply the product-specific construction, fit and measurement rules above exactly.\n'
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
  hasPersonaIdentityImage?: boolean;
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
  hasPersonaIdentityImage: boolean,
): string {
  const lines: string[] = [];
  if (hasPersonaImage && hasPersonaIdentityImage) {
    lines.push(
      `[IMAGE A1 — MODEL IDENTITY CLOSE-UP]: tight face and hair reference for the exact campaign model. ` +
      `Use this person's exact facial geometry, features, skin tone, and hair. Ignore all visible clothing and accessories.`,
    );
    lines.push(
      `[IMAGE A2 — MODEL FULL-BODY REFERENCE]: the same campaign model. Use her exact body proportions and build. ` +
      `Ignore her clothing, shoes, and accessories; no product design may come from this image.`,
    );
  } else if (hasPersonaImage) {
    lines.push(
      `[IMAGE A — THE MODEL]: photo of the model. Use her EXACT face, skin tone, hair, and body. ` +
      `Ignore her clothing, shoes, and accessories; all product design comes only from garment references.`,
    );
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
  const persona = findPersonaForBrand(brand, personaId);
  const primaryAngle = viewAngle ?? 'front';

  // If we have a persona image, we use a multi-image workflow with explicit labels
  if (persona && persona.id !== 'none' && o.hasPersonaImage) {
    const modelReference = o.hasPersonaIdentityImage ? 'Images A1 and A2' : 'Image A';
    return (
      `You are a world-class fashion photographer creating a virtual try-on. ` +
      `I am providing these reference images:\n` +
      `${referenceManifest(primaryAngle, supportingAngles, true, Boolean(o.hasPersonaIdentityImage))}\n\n` +
      `YOUR TASK: Perform a constrained wardrobe-and-scene edit using the exact MODEL from ${modelReference} wearing the GARMENT from Image B. ` +
      `Treat the model's identity as immutable, as if only her wardrobe and photoshoot setting changed; do not regenerate a new or similar person.\n\n` +
      `CRITICAL — MODEL IDENTITY:\n` +
      `- Identity is a hard constraint, not a suggestion. The output MUST show the same individual from ${modelReference}; ` +
      `do not substitute, average, beautify, age, or invent a similar-looking person.\n` +
      `- Copy the model's facial geometry, eye shape and spacing, eyebrows, nose, lips, jawline, smile, skin tone ` +
      `(${persona.skinTone}), hairline, hair texture, hair length, and parting exactly.\n` +
      `- Ignore and replace every garment, shoe, and accessory visible in ${modelReference}. They identify the person only; ` +
      `the trousers and all product construction, colour, fabric, and trim must come exclusively from Image B and its supporting garment references.\n` +
      `- If Image B shows a different person wearing the garment, IGNORE that person completely. Only use Image B for the garment design.\n` +
      `- Model height: ${persona.height}. Body type: ${persona.bodyShape}.\n\n` +
      `${garmentAccuracyClause(viewAngle, grounded, hasSupporting, traits)}\n` +
      `${productSpecificRulesClause(garmentFitNotes)}\n` +
      `${fitCalibrationClause(persona, garmentFitNotes)}\n` +
      `${poseVariationClause(viewAngle, poseInstruction, traits)}\n` +
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
      `- ${viewAngleClause(viewAngle, traits)}\n` +
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
    `${referenceManifest(primaryAngle, supportingAngles, false, false)}\n\n` +
    `${garmentAccuracyClause(viewAngle, grounded, hasSupporting, traits)}\n\n` +
    `${productSpecificRulesClause(garmentFitNotes)}\n` +
    `${fitCalibrationClause(persona, garmentFitNotes)}\n\n` +
    `${poseVariationClause(viewAngle, poseInstruction, traits)}\n\n` +
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
  const persona = findPersonaForBrand(brand, personaId);
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
    `${productSpecificRulesClause(garmentFitNotes)} ` +
    `${fitCalibrationClause(persona, garmentFitNotes)} ` +
    `${poseVariationClause(viewAngle, poseInstruction, traits)} ` +
    `Visual aesthetic: ${style.aesthetic}. Color palette: ${style.colorPalette}. Mood: ${style.mood}. ` +
    `${viewAngleClause(viewAngle, traits)} The garment is the hero — all key design details clearly visible. ` +
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
    const selectedPersona = findPersonaForBrand(input.brand, input.personaId);
    if (input.personaId !== 'none' && !selectedPersona) {
      throw new Error(
        `The selected model "${input.personaId}" is not available for brand "${input.brand}". ` +
        `No creative was generated because substituting another person would be misleading.`,
      );
    }

    // Loaded before the prompt is written, not after. The prompt describes the
    // images it is sent with, so it must not be able to promise a model
    // reference that never arrives.
    const personaImage = await loadPersonaImage(selectedPersona);
    if (selectedPersona && !personaImage) {
      throw new Error(
        `The reference photo for model "${selectedPersona.label}" could not be loaded. ` +
        `No creative was generated because the selected model could not be preserved.`,
      );
    }
    const hasPersonaImage = !!personaImage;
    const personaIdentityImage = personaImage
      ? await createPersonaIdentityReference(personaImage)
      : null;
    const hasPersonaIdentityImage = !!personaIdentityImage;
    if (personaImage && !personaIdentityImage) {
      if (input.quality === 'high_accuracy') {
        throw new Error(
          `The identity close-up for model "${input.personaId}" could not be prepared. ` +
          `No creative was generated because High Accuracy identity verification could not run.`,
        );
      }
      logWarn(
        'CreativeGen',
        `Could not create the identity close-up for persona "${input.personaId}"; using only the full-body reference.`,
      );
    }

    const scene = resolveScene(
      input.sceneKey?.trim() || input.productContext,
      `${input.productContext} ${input.garmentFitNotes ?? ''}`,
    );
    const imageModel = input.quality === 'high_accuracy' ? HIGH_ACCURACY_IMAGE_MODEL : IMAGE_EDIT_MODEL;
    const outputImageSize = input.quality === 'high_accuracy' ? '2K' : '1K';
    const supportingAngles = supporting.map(ref => ref.angle);
    const basePrompt = buildTryOnPrompt({
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
      hasPersonaIdentityImage,
      scene: sceneClause(scene),
    }, supportingAngles);

    logInfo('CreativeGen', 'Starting try-on generation.', {
      model: imageModel,
      brand: input.brand,
      personaId: input.personaId,
      personaReferenceAttached: hasPersonaImage,
      identityCloseupAttached: hasPersonaIdentityImage,
      viewAngle: input.viewAngle ?? 'front',
      grounded,
      supportingReferenceCount: supporting.length,
      referenceAngles: [primary.angle, ...supportingAngles],
      primaryReferenceFingerprint: fidelityFingerprint(primary.base64),
      personaReferenceFingerprint: personaImage ? fidelityFingerprint(personaImage.base64) : null,
      authoritativeRulesFingerprint: fidelityFingerprint(input.garmentFitNotes ?? ''),
      quality: input.quality ?? 'standard',
      outputImageSize,
      fidelityReviewEnabled: input.quality === 'high_accuracy',
      maxGenerationAttempts: input.quality === 'high_accuracy' ? 2 : 1,
    });

    logDebug(
      'CreativeGen',
      `Try-on generation via ${imageModel} — brand "${input.brand}" persona "${input.personaId}" ` +
      `angle "${input.viewAngle ?? 'front'}" (${grounded ? 'photo-grounded' : 'inferred'}), ` +
      `${supporting.length} supporting reference(s).`,
    );

    // Parts order: [prompt] -> [Image A1/A2: persona identity + body] ->
    // [Image B: primary garment reference] -> [Image C..: other angles].
    // Persona goes FIRST so the AI anchors on the model's identity before seeing the garment.
    const referenceParts: GeminiContentPart[] = [];

    // Image A/A1/A2 — MODEL references — go first to anchor identity.
    // Already loaded, and the prompt above was written knowing whether it
    // exists, so the labels here cannot drift out of step with the prompt.
    if (personaImage) {
      if (personaIdentityImage) {
        referenceParts.push({
          text: 'IMAGE A1 - MODEL IDENTITY CLOSE-UP. Copy this exact face, skin tone, hairline, hair texture, and hairstyle. Ignore visible clothing and accessories.',
        });
        referenceParts.push({
          inlineData: { data: personaIdentityImage.base64, mimeType: personaIdentityImage.mimeType },
        });
        referenceParts.push({
          text: 'IMAGE A2 - SAME MODEL, FULL BODY. Copy this exact person and her body proportions. Ignore all clothing, shoes, and accessories.',
        });
      } else {
        referenceParts.push({
          text: 'IMAGE A - MODEL REFERENCE. Use only this person for face, body, hair, and skin tone. Ignore all clothing, shoes, and accessories.',
        });
      }
      referenceParts.push({
        inlineData: { data: personaImage.base64, mimeType: personaImage.mimeType },
      });
      logDebug(
        'CreativeGen',
        `[Image A — MODEL] persona "${input.personaId}" attached` +
        (personaIdentityImage ? ' with identity close-up' : ''),
      );
    }

    // Image B — GARMENT, photographed from the angle being generated
    const primaryAngleNoun = ANGLE_NOUN[primary.angle];
    const modelReference = personaIdentityImage ? 'Images A1/A2 model' : 'Image A model';
    referenceParts.push({
      // Keyed off the bytes, not the URL. Referring to "the Image A model" when
      // no Image A was attached is what set the model adrift.
      text: personaImage
        ? `IMAGE B - GARMENT PRODUCT REFERENCE (${primaryAngleNoun} VIEW). Duplicate this garment exactly on the ${modelReference}.`
        : `IMAGE B - GARMENT PRODUCT REFERENCE (${primaryAngleNoun} VIEW). Generate this exact garment/product without changing design or color.`,
    });
    referenceParts.push({
      inlineData: { data: primary.base64, mimeType: primary.mimeType },
    });

    // Image C onward — the same garment from other angles. These resolve
    // construction details the primary photo cannot show, so the model no
    // longer has to invent a back or side it has never seen.
    supporting.forEach((ref, index) => {
      referenceParts.push({
        text: `IMAGE ${String.fromCharCode(67 + index)} - SAME GARMENT, ${ANGLE_NOUN[ref.angle]} VIEW. ` +
          `Use for construction, colour, and trim consistency only. Do not reproduce this camera angle.`,
      });
      referenceParts.push({
        inlineData: { data: ref.base64, mimeType: ref.mimeType },
      });
    });
    logDebug(
      'CreativeGen',
      `[Image B — GARMENT ${primaryAngleNoun}] plus ${supporting.length} supporting angle(s): ` +
      `${supporting.map(ref => ref.angle).join(', ') || 'none'}.`,
    );

    const maxGenerationAttempts = input.quality === 'high_accuracy' ? 2 : 1;
    const traits = detectGarmentTraits(`${input.productContext} ${input.garmentFitNotes ?? ''}`);
    let attemptPrompt = basePrompt;

    for (let generationAttempt = 1; generationAttempt <= maxGenerationAttempts; generationAttempt += 1) {
      logInfo('CreativeGen', 'Requesting try-on candidate.', {
        model: imageModel,
        generationAttempt,
        maxGenerationAttempts,
        viewAngle: input.viewAngle ?? 'front',
      });
      const parts: GeminiContentPart[] = [{ text: attemptPrompt }, ...referenceParts];
      const response = await ai.models.generateContent({
        model: imageModel,
        contents: [{
          role: 'user',
          parts,
        }],
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
          imageConfig: {
            aspectRatio,
            imageSize: outputImageSize,
          },
        },
      });

      const candidates = response.candidates ?? [];
      let generated: { base64: string; mimeType: string } | null = null;
      for (const candidate of candidates) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data && part.inlineData?.mimeType) {
            generated = { base64: part.inlineData.data, mimeType: part.inlineData.mimeType };
            break;
          }
        }
        if (generated) break;
      }

      if (!generated) {
        // If the model returned text instead of an image (e.g. safety refusal), surface it.
        const textPart = candidates[0]?.content?.parts?.find(p => p.text);
        const reason = textPart?.text ?? candidates[0]?.finishReason ?? 'unknown';
        logError('CreativeGen', `${imageModel} returned no image.`, { reason, generationAttempt });
        throw new Error(
          `Image generation was blocked or returned no output. Reason: ${reason}. ` +
          `Try rephrasing the product description or using a different product image.`,
        );
      }

      if (input.quality !== 'high_accuracy') {
        const imageData = `data:${generated.mimeType};base64,${generated.base64}`;
        logDebug('CreativeGen', 'Standard try-on creative generated successfully.');
        return { imageData, mimeType: generated.mimeType, prompt: attemptPrompt, grounded };
      }

      const fidelityDecision = await reviewCreativeFidelity({
        ai,
        personaId: input.personaId,
        personaIdentity: personaIdentityImage,
        personaFullBody: personaImage,
        primaryReference: primary,
        candidate: generated,
        viewAngle: input.viewAngle ?? 'front',
        traits,
        productContext: input.productContext,
        authoritativeRules: input.garmentFitNotes,
        generationAttempt,
      });

      if (fidelityDecision.pass) {
        const imageData = `data:${generated.mimeType};base64,${generated.base64}`;
        logInfo('CreativeGen', 'High Accuracy candidate passed visual verification.', {
          generationAttempt,
          validatorModel: fidelityDecision.validatorModel,
          viewAngle: input.viewAngle ?? 'front',
        });
        return { imageData, mimeType: generated.mimeType, prompt: attemptPrompt, grounded };
      }

      logWarn('CreativeGen', 'High Accuracy candidate rejected by visual verification.', {
        generationAttempt,
        maxGenerationAttempts,
        failedChecks: fidelityDecision.failedChecks,
        viewAngle: input.viewAngle ?? 'front',
      });
      if (generationAttempt < maxGenerationAttempts) {
        attemptPrompt = `${basePrompt}\n\n${buildFidelityRetryCorrection(fidelityDecision.failedChecks)}`;
        continue;
      }

      throw new Error(
        `High Accuracy rejected the generated image because it did not match the selected model or product ` +
        `(${fidelityDecision.failedChecks.join(', ')}). No image was saved. Please retry.`,
      );
    }

    throw new Error('High Accuracy generation ended without a verified image. No image was saved.');
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
