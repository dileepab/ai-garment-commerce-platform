import { GoogleGenAI, Modality } from '@google/genai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logDebug, logError } from '@/lib/app-log';

// ── Brand style system ───────────────────────────────────────────────────────

interface BrandStyle {
  colorPalette: string;
  aesthetic: string;
  mood: string;
}

const DEFAULT_STYLE: BrandStyle = {
  colorPalette: 'warm neutrals, soft pinks, ivory, dusty rose',
  aesthetic: 'feminine, elegant, modern',
  mood: 'aspirational yet accessible',
};

function getBrandStyle(brand: string): BrandStyle {
  void brand; // placeholder for per-brand style lookup in a later phase
  return DEFAULT_STYLE;
}

// ── Persona system ───────────────────────────────────────────────────────────

import { PERSONAS_BY_BRAND, type PersonaId, type PersonaDef } from './persona-data';
export type { PersonaId };

function getPersona(brand: string, personaId: string): PersonaDef | undefined {
  return PERSONAS_BY_BRAND[brand]?.find(p => p.id === personaId);
}

// ── Models ───────────────────────────────────────────────────────────────────

// Accepts image input AND generates image output via generateContent.
// This enables the virtual try-on path (product photo → model wearing it).
const IMAGE_EDIT_MODEL = 'gemini-2.5-flash-image';

// Text-to-image only — used when no source image is provided.
const TEXT_TO_IMAGE_MODEL = 'imagen-4.0-generate-001';

// ── Interfaces ───────────────────────────────────────────────────────────────

export type ViewAngle = 'front' | 'side' | 'back' | 'closeup';

export interface CreativeGenerationInput {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  garmentFitNotes?: string;
  sourceImageBase64?: string;
  sourceImageMimeType?: string;
  viewAngle?: ViewAngle;
  // Free-form correction note appended to the prompt as a final user instruction.
  // Used by per-tile regenerate to fix specific issues (e.g. "no buttons on back").
  correctionText?: string;
}

// Camera + composition guidance per view angle.
function viewAngleClause(angle: ViewAngle | undefined): string {
  switch (angle) {
    case 'side':
      return 'Camera angle: full profile (90 degrees) side view of the model. Show the side silhouette, but keep any front floral/graphic artwork anchored on the garment front panel near the model-facing/front edge. Do not center the artwork on the side seam, underarm, or side torso.';
    case 'back':
      return 'Camera angle: rear view of the model facing away from camera. Showcase the back neckline, sleeve shape, stripe continuation, and hemline. Keep the back plain if the source garment appears plain: no added vertical seam lines, black contour lines, darts, piping, or panels.';
    case 'closeup':
      return 'Camera angle: tight close-up on the garment fabric, print, buttons, stitching, and construction details. Half-body crop, sharp focus on the exact source garment texture.';
    case 'front':
    default:
      return 'Camera angle: front-facing three-quarter or full-body shot of the model. The front of the garment must match the source image exactly.';
  }
}

function garmentAccuracyClause(viewAngle: ViewAngle | undefined): string {
  const angleSpecific = viewAngle === 'back'
    ? '- For the back view, infer only the hidden back shape from the same garment. Keep color, fabric, sleeve shape, neckline style, and hem shape consistent; do not transplant front-only decoration to the back. Do not add vertical black back contour lines, princess seams, darts, piping, or panel lines unless Image B clearly shows them.\n'
    : viewAngle === 'side'
      ? '- For the side view, the floral/graphic artwork remains on the front-left panel of the garment. It should appear only on the visible front edge/near-front torso, with the same height from the hem and the same distance from the button placket as the source. Never move the artwork to the center of the side panel or underneath the sleeve. Keep the side seam closed; do not expose skin through a slit or side opening.\n'
      : viewAngle === 'front'
        ? '- For the front view, duplicate the source neckline exactly. If the source neckline is a smooth continuous round/scoop neck, keep it smooth and continuous: no V slit, notch, keyhole, vertical opening, collar, tie, zipper, or extra cutout at the center front. Keep both dress sides closed; do not expose leg/skin through a slit.\n'
        : '';

  return (
    `GARMENT FIDELITY - HIGHEST PRIORITY:\n` +
    `- Before rendering, inspect Image B and mentally lock the garment blueprint: neckline shape, side seams/openings, back seams, stripe sequence, sleeve cuff/hem color, artwork placement, hem curve, and fabric color.\n` +
    `- Treat Image B as a product reference that must be duplicated, not re-designed or re-colored.\n` +
    `- The output garment must be the same SKU/product as Image B. A different color, darker/lighter color family, alternate neckline, different sleeve roll, different hem, changed button line, or moved floral/graphic placement is a failed result.\n` +
    `- For striped garments, preserve the exact stripe sequence, band thickness, spacing, and color order across body, sleeves, neckline, side panels, and back. Do not turn a red garment into mostly white, do not remove red base areas, and do not change thin dark stripe positions.\n` +
    `- Thin black lines in Image B are pinstripes only. Never convert thin pinstripes into thick black cuffs, thick black sleeve hems, a thick black bottom hem band, black piping, or black binding.\n` +
    `- For side seams and hems, copy Image B exactly. Do not invent side slits, open side panels, wrap openings, overlapping side flaps, vents, or cutouts. A flat-lay fold or visible side layer is not permission to create a slit on the model.\n` +
    `- Sleeve hems/cuffs must copy Image B exactly. Do not create a black sleeve cuff, black sleeve hem, or dark sleeve edge unless the source sleeve hem itself is a thick black cuff.\n` +
    `- Dress bottom hem must copy Image B exactly. Do not create a thick black bottom band or black border; preserve only the same thin stripe/hem details visible in Image B.\n` +
    `- Back view must stay faithful to the source construction. Do not add two vertical black lines, princess seams, darts, piping, or contour panels unless Image B explicitly shows those lines.\n` +
    `- The neckline must be copied exactly. Do not invent a center-front neck slit, V notch, keyhole, collar, zipper, or extra opening unless that exact opening is clearly visible in Image B.\n` +
    `- The front placket/buttons must start and stop where they do in Image B. Do not extend the placket into the neckline or create a new opening above the first real button.\n` +
    `- Preserve the exact base color/hue from Image B under realistic lighting. Do not let brand palette, warm sunlight, shadows, or color grading shift the garment into black, gray, blue, brown, or another green.\n` +
    `- Preserve the exact print/embroidery artwork, scale, orientation, and placement relative to the neckline, placket, side seams, bust, waist, and hem.\n` +
    `- Floral/graphic placement must be spatially faithful: keep the same side of the garment, same vertical height, same distance from the hem, and same relationship to the placket/buttons. Do not slide it toward the side seam or center torso.\n` +
    `- Preserve every visible construction detail: button count, button color/rim, button spacing, placket position, seams, cuffs, sleeve length, sleeve opening width, shoulder seam position, neckline shape, fabric texture, and hem curve.\n` +
    `- Sleeve length must match Image B exactly relative to the upper arm/elbow/wrist. Do not lengthen short sleeves into longer sleeves or shorten longer sleeves unless the user correction explicitly asks for it.\n` +
    `- Do not add, remove, mirror, relocate, resize, recolor, or simplify buttons, flowers, seams, folds, or trims.\n` +
    angleSpecific +
    `- Fit the exact garment onto the model naturally; only the model pose, background, and companion clothing may change.`
  );
}

function hardRejectClause(garmentFitNotes: string | undefined): string {
  const noSideSlit = garmentFitNotes?.toLowerCase().includes('no side slit')
    ? '- The user explicitly says "no side slit": the rendered dress must have fully closed side seams with no leg/skin visible through the side.\n'
    : '';

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
const OUTFIT_COMPLETION_CLAUSE =
  'OUTFIT COMPLETION: If the garment in Image B is a top/blouse/shirt, pair it with neutral, complementary trousers or a simple skirt that matches the garment palette. ' +
  'If it is a bottom (pants/skirt/shorts), add a simple, neutral matching top. ' +
  'If it is already a full-length dress, jumpsuit or one-piece, do NOT add other clothing. ' +
  'The added clothing must look natural, low-key, and never distract from the hero garment.';

export interface CreativeGenerationResult {
  imageData: string; // data URL: data:<mimeType>;base64,<data>
  mimeType: string;
  prompt: string;
}

type GeminiContentPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } };

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildTryOnPrompt(
  brand: string,
  personaId: PersonaId,
  productContext: string,
  style: BrandStyle,
  hasPersonaImage: boolean,
  viewAngle: ViewAngle | undefined,
  garmentFitNotes: string | undefined,
  correctionText: string | undefined,
): string {
  const correctionLine = correctionText?.trim()
    ? `\n\nUSER CORRECTION (highest priority — fix this in the new image): ${correctionText.trim()}`
    : '';
  const persona = getPersona(brand, personaId);

  // If we have a persona image, we use a two-image workflow with explicit labels
  if (persona && persona.id !== 'none' && hasPersonaImage) {
    return (
      `You are a world-class fashion photographer creating a virtual try-on. ` +
      `I am providing two reference images:\n` +
      `[IMAGE A — THIS IS THE MODEL]: The FIRST image is a photo of the model. Use her EXACT face, skin tone, hair, and body.\n` +
      `[IMAGE B — THIS IS THE GARMENT]: The SECOND image shows the dress/garment to put on her. ONLY use the clothing from this image — COMPLETELY IGNORE any person wearing it.\n\n` +
      `YOUR TASK: Generate a brand-new, high-quality fashion photograph of the MODEL from Image A wearing the GARMENT from Image B.\n\n` +
      `CRITICAL — MODEL IDENTITY:\n` +
      `- The person in the output MUST be the model from Image A. Same face, same hair, same skin tone (${persona.skinTone}).\n` +
      `- If Image B shows a different person wearing the garment, IGNORE that person completely. Only use Image B for the garment design.\n` +
      `- Model height: ${persona.height}. Body type: ${persona.bodyShape}.\n\n` +
      `${garmentAccuracyClause(viewAngle)}\n` +
      `${fitCalibrationClause(persona, garmentFitNotes)}\n` +
      `- The garment must drape naturally on the model's body with realistic folds and shadows.\n` +
      (productContext.trim() ? `- Garment details: ${productContext.trim()}.\n` : '') +
      `\n${OUTFIT_COMPLETION_CLAUSE}\n` +
      `\nPHOTOGRAPHY — MAKE IT LOOK 100% REAL:\n` +
      `- Shot on Canon EOS R5, 85mm f/1.4 lens. Shallow depth of field with creamy bokeh.\n` +
      `- Natural skin texture: visible pores, subtle skin imperfections, realistic subsurface scattering on skin.\n` +
      `- Slight natural wind movement in hair and fabric for a candid, lived-in feel.\n` +
      `- Setting: Beautiful, aspirational ${style.aesthetic} outdoor location. Golden hour warm sunlight with soft shadows.\n` +
      `- Realistic catch-lights in the model's eyes. Natural color grading for skin and scene only; keep the garment color matched to Image B.\n` +
      `- Subtle film grain for an authentic editorial feel. NOT overly smooth or airbrushed.\n` +
      `- ${viewAngleClause(viewAngle)}\n` +
      `- Style: Premium ${brand} brand campaign. ${style.mood}.\n` +
      `${hardRejectClause(garmentFitNotes)}\n` +
      `- Absolutely NO text, logos, or watermarks.` +
      correctionLine
    );
  }

  // Fallback: no persona, product-only shot
  const contextNote = productContext.trim()
    ? ` The garment is described as: ${productContext.trim()}.` : '';

  return (
    `Generate a professional fashion marketing photo showing the exact source garment in a premium setting.\n\n` +
    `${garmentAccuracyClause(viewAngle)}\n\n` +
    `${fitCalibrationClause(persona, garmentFitNotes)}\n\n` +
    `${contextNote} ` +
    `Brand: ${brand}. Visual style: ${style.aesthetic}. Mood: ${style.mood}. ` +
    `High-end editorial composition. Sharp focus, beautiful lighting. ` +
    `${hardRejectClause(garmentFitNotes)} ` +
    `No text, logos, or watermarks.` +
    correctionLine
  );
}

function buildTextToImagePrompt(
  brand: string,
  personaId: PersonaId,
  productContext: string,
  style: BrandStyle,
  viewAngle: ViewAngle | undefined,
  garmentFitNotes: string | undefined,
  correctionText: string | undefined,
): string {
  const correctionLine = correctionText?.trim()
    ? ` USER CORRECTION (highest priority — fix this in the new image): ${correctionText.trim()}.`
    : '';
  const persona = getPersona(brand, personaId);
  const garment = productContext.trim() || 'a fashion garment';

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
    `Visual aesthetic: ${style.aesthetic}. Color palette: ${style.colorPalette}. Mood: ${style.mood}. ` +
    `${viewAngleClause(viewAngle)} The garment is the hero — all key design details clearly visible. ` +
    `Professional studio or natural fashion lighting. Sharp focus on the outfit. ` +
    `${hardRejectClause(garmentFitNotes)} ` +
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
  const hasSourceImage = !!(input.sourceImageBase64 && input.sourceImageMimeType);

  // ── Path A: image-in → image-out (virtual try-on) ────────────────────────
  // gemini-2.5-flash-image accepts the product photo and generates a new image
  // of a model wearing exactly that garment.

  if (hasSourceImage) {
    const selectedPersona = getPersona(input.brand, input.personaId);
    const hasPersonaImage = !!(selectedPersona?.imageUrl);
    const prompt = buildTryOnPrompt(input.brand, input.personaId, input.productContext, style, hasPersonaImage, input.viewAngle, input.garmentFitNotes, input.correctionText);

    logDebug('CreativeGen', `Try-on generation via ${IMAGE_EDIT_MODEL} — brand "${input.brand}" persona "${input.personaId}".`);

    // Parts order: [prompt] -> [Image A: persona/model] -> [Image B: garment]
    // Persona goes FIRST so the AI anchors on the model's identity before seeing the garment.
    const parts: GeminiContentPart[] = [
      { text: prompt },
    ];

    // Image A — MODEL (persona reference) — goes first to anchor identity
    if (selectedPersona?.imageUrl) {
      try {
        const imagePath = path.join(process.cwd(), 'public', selectedPersona.imageUrl);
        
        if (fs.existsSync(imagePath)) {
          const buffer = fs.readFileSync(imagePath);
          const base64 = buffer.toString('base64');
          
          let contentType = 'image/jpeg';
          if (selectedPersona.imageUrl.endsWith('.png')) contentType = 'image/png';
          else if (selectedPersona.imageUrl.endsWith('.webp')) contentType = 'image/webp';

          parts.push({
            text: 'IMAGE A - MODEL REFERENCE. Use only this person for face, body, hair, and skin tone.',
          });
          parts.push({
            inlineData: {
              data: base64,
              mimeType: contentType,
            },
          });
          logDebug('CreativeGen', `[Image A — MODEL] Loaded persona for ${input.personaId} from disk`);
        } else {
          logError('CreativeGen', `Persona image not found on disk: ${imagePath}`);
        }
      } catch (e) {
        logError('CreativeGen', 'Failed to load persona image reference from disk', e);
      }
    }

    // Image B — GARMENT (product photo) — goes second
    parts.push({
      text: selectedPersona?.imageUrl
        ? 'IMAGE B - GARMENT PRODUCT REFERENCE. Duplicate this garment exactly on Image A model.'
        : 'IMAGE B - GARMENT PRODUCT REFERENCE. Generate this exact garment/product without changing design or color.',
    });
    parts.push({
      inlineData: {
        data: input.sourceImageBase64!,
        mimeType: input.sourceImageMimeType!,
      },
    });
    logDebug('CreativeGen', `[Image B — GARMENT] Added product source image.`);

    const response = await ai.models.generateContent({
      model: IMAGE_EDIT_MODEL,
      contents: [{
        role: 'user',
        parts,
      }],
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    const candidates = response.candidates ?? [];
    for (const candidate of candidates) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData?.mimeType) {
          const mimeType = part.inlineData.mimeType;
          const imageData = `data:${mimeType};base64,${part.inlineData.data}`;
          logDebug('CreativeGen', 'Try-on creative generated successfully.');
          return { imageData, mimeType, prompt };
        }
      }
    }

    // If the model returned text instead of an image (e.g. safety refusal), surface it
    const textPart = candidates[0]?.content?.parts?.find(p => p.text);
    const reason = textPart?.text ?? candidates[0]?.finishReason ?? 'unknown';
    logError('CreativeGen', `${IMAGE_EDIT_MODEL} returned no image.`, { reason });
    throw new Error(
      `Image generation was blocked or returned no output. Reason: ${reason}. ` +
      `Try rephrasing the product description or using a different product image.`,
    );
  }

  // ── Path B: text-to-image (no source photo) ──────────────────────────────
  // Imagen 4 is used when the user only provides a text description.

  const prompt = buildTextToImagePrompt(input.brand, input.personaId, input.productContext, style, input.viewAngle, input.garmentFitNotes, input.correctionText);

  logDebug('CreativeGen', `Text-to-image via ${TEXT_TO_IMAGE_MODEL} — brand "${input.brand}" persona "${input.personaId}".`);

  const genResponse = await ai.models.generateImages({
    model: TEXT_TO_IMAGE_MODEL,
    prompt,
    config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: '4:3' },
  });

  const generated = genResponse.generatedImages?.[0];
  if (!generated?.image?.imageBytes) {
    logError('CreativeGen', 'generateImages returned no image bytes.');
    throw new Error(
      'Image generation returned no image data. The content may have been filtered — ' +
      'try rephrasing the product description.',
    );
  }

  const mimeType = generated.image.mimeType ?? 'image/jpeg';
  const imageData = `data:${mimeType};base64,${generated.image.imageBytes}`;
  logDebug('CreativeGen', 'Text-to-image creative generated successfully.');
  return { imageData, mimeType, prompt };
}
