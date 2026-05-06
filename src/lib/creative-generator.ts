import { GoogleGenAI, Modality } from '@google/genai';
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
      return 'Camera angle: full profile (90°) side view of the model. Show the silhouette of the garment from the side.';
    case 'back':
      return 'Camera angle: rear view of the model facing away from camera. Showcase the back of the garment — neckline, seams, hemline.';
    case 'closeup':
      return 'Camera angle: tight close-up on the garment fabric, print and stitching detail. Half-body crop, sharp focus on garment texture.';
    case 'front':
    default:
      return 'Camera angle: front-facing three-quarter or full-body shot of the model.';
  }
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

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildTryOnPrompt(
  brand: string,
  personaId: PersonaId,
  productContext: string,
  style: BrandStyle,
  hasPersonaImage: boolean,
  viewAngle: ViewAngle | undefined,
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
      `GARMENT ACCURACY:\n` +
      `- Copy the garment's exact print, pattern, colours, fabric texture, and silhouette from Image B.\n` +
      `- The garment must drape naturally on the model's body with realistic folds and shadows.\n` +
      (productContext.trim() ? `- Garment details: ${productContext.trim()}.\n` : '') +
      `\n${OUTFIT_COMPLETION_CLAUSE}\n` +
      `\nPHOTOGRAPHY — MAKE IT LOOK 100% REAL:\n` +
      `- Shot on Canon EOS R5, 85mm f/1.4 lens. Shallow depth of field with creamy bokeh.\n` +
      `- Natural skin texture: visible pores, subtle skin imperfections, realistic subsurface scattering on skin.\n` +
      `- Slight natural wind movement in hair and fabric for a candid, lived-in feel.\n` +
      `- Setting: Beautiful, aspirational ${style.aesthetic} outdoor location. Golden hour warm sunlight with soft shadows.\n` +
      `- Realistic catch-lights in the model's eyes. Natural color grading — not over-saturated.\n` +
      `- Subtle film grain for an authentic editorial feel. NOT overly smooth or airbrushed.\n` +
      `- ${viewAngleClause(viewAngle)}\n` +
      `- Style: Premium ${brand} brand campaign. ${style.mood}.\n` +
      `- Absolutely NO text, logos, or watermarks.` +
      correctionLine
    );
  }

  // Fallback: no persona, product-only shot
  const contextNote = productContext.trim()
    ? ` The garment is described as: ${productContext.trim()}.` : '';

  return (
    `Generate a professional fashion marketing photo showing this exact dress in a premium setting.` +
    `${contextNote} ` +
    `Brand: ${brand}. Visual style: ${style.aesthetic}. Mood: ${style.mood}. ` +
    `High-end editorial composition. Sharp focus, beautiful lighting. ` +
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
    `Visual aesthetic: ${style.aesthetic}. Color palette: ${style.colorPalette}. Mood: ${style.mood}. ` +
    `${viewAngleClause(viewAngle)} The garment is the hero — all key design details clearly visible. ` +
    `Professional studio or natural fashion lighting. Sharp focus on the outfit. ` +
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
    const prompt = buildTryOnPrompt(input.brand, input.personaId, input.productContext, style, hasPersonaImage, input.viewAngle, input.correctionText);

    logDebug('CreativeGen', `Try-on generation via ${IMAGE_EDIT_MODEL} — brand "${input.brand}" persona "${input.personaId}".`);

    // Parts order: [prompt] → [Image A: persona/model] → [Image B: garment]
    // Persona goes FIRST so the AI anchors on the model's identity before seeing the garment.
    const parts: any[] = [
      { text: prompt },
    ];

    // Image A — MODEL (persona reference) — goes first to anchor identity
    if (selectedPersona?.imageUrl) {
      try {
        const fs = require('fs');
        const path = require('path');
        const imagePath = path.join(process.cwd(), 'public', selectedPersona.imageUrl);
        
        if (fs.existsSync(imagePath)) {
          const buffer = fs.readFileSync(imagePath);
          const base64 = buffer.toString('base64');
          
          let contentType = 'image/jpeg';
          if (selectedPersona.imageUrl.endsWith('.png')) contentType = 'image/png';
          else if (selectedPersona.imageUrl.endsWith('.webp')) contentType = 'image/webp';

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

  const prompt = buildTextToImagePrompt(input.brand, input.personaId, input.productContext, style, input.viewAngle, input.correctionText);

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
