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

export const PERSONA_OPTIONS = [
  { id: 'none',               label: 'Product only (no model)' },
  { id: 'young-professional', label: 'Young professional woman (25–30)' },
  { id: 'casual-chic',        label: 'Casual-chic woman (20s)' },
  { id: 'elegant-mature',     label: 'Elegant woman (30s–40s)' },
] as const;

export type PersonaId = (typeof PERSONA_OPTIONS)[number]['id'];

const PERSONA_DESCRIPTIONS: Record<PersonaId, string | null> = {
  none: null,
  'young-professional':
    'a confident South Asian professional woman in her late 20s, natural smile, bright clean indoor setting',
  'casual-chic':
    'a stylish South Asian woman in her mid-20s, modern urban outdoor environment, golden-hour light',
  'elegant-mature':
    'an elegant South Asian woman in her mid-30s to early 40s, sophisticated minimal background, soft studio lighting',
};

// ── Models ───────────────────────────────────────────────────────────────────

// Accepts image input AND generates image output via generateContent.
// This enables the virtual try-on path (product photo → model wearing it).
const IMAGE_EDIT_MODEL = 'gemini-2.5-flash-image';

// Text-to-image only — used when no source image is provided.
const TEXT_TO_IMAGE_MODEL = 'imagen-4.0-generate-001';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface CreativeGenerationInput {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  sourceImageBase64?: string;
  sourceImageMimeType?: string;
}

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
): string {
  const persona = PERSONA_DESCRIPTIONS[personaId];

  const contextNote = productContext.trim()
    ? ` The garment is described as: ${productContext.trim()}.` : '';

  const subjectClause = persona
    ? `Generate a professional fashion marketing photo of ${persona} wearing EXACTLY this dress from the product image.`
    : `Generate a professional fashion marketing photo showing this exact dress as a clean flat-lay or on a mannequin.`;

  return (
    `${subjectClause}` +
    `${contextNote} ` +
    `Preserve every detail of the dress with complete accuracy: the exact print, pattern, colours, fabric texture, ` +
    `silhouette, neckline style, sleeve type, hemline length, and all design details. ` +
    `Do not substitute or alter the garment design in any way. ` +
    `Brand: ${brand} — a Sri Lankan women's fashion label. ` +
    `Visual style: ${style.aesthetic}. Mood: ${style.mood}. ` +
    `Full-body or three-quarter editorial shot. The outfit is the hero — all garment details clearly visible. ` +
    `Professional fashion photography lighting. Post-ready social media composition. ` +
    `No text, logos, or watermarks.`
  );
}

function buildTextToImagePrompt(
  brand: string,
  personaId: PersonaId,
  productContext: string,
  style: BrandStyle,
): string {
  const persona = PERSONA_DESCRIPTIONS[personaId];
  const garment = productContext.trim() || 'a fashion garment';

  const subjectClause = persona
    ? `${persona} wearing: ${garment}`
    : `clean flat-lay of: ${garment}`;

  return (
    `Professional fashion marketing photograph for ${brand}, a Sri Lankan women's fashion brand. ` +
    `Subject: ${subjectClause}. ` +
    `Visual aesthetic: ${style.aesthetic}. Color palette: ${style.colorPalette}. Mood: ${style.mood}. ` +
    `Full-body or three-quarter fashion editorial shot. The garment is the hero — all key design details clearly visible. ` +
    `Professional studio or natural fashion lighting. Sharp focus on the outfit. ` +
    `Post-ready social media marketing composition. No text, logos, or watermarks.`
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
    const prompt = buildTryOnPrompt(input.brand, input.personaId, input.productContext, style);

    logDebug('CreativeGen', `Try-on generation via ${IMAGE_EDIT_MODEL} — brand "${input.brand}" persona "${input.personaId}".`);

    const response = await ai.models.generateContent({
      model: IMAGE_EDIT_MODEL,
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              data: input.sourceImageBase64!,
              mimeType: input.sourceImageMimeType!,
            },
          },
          { text: prompt },
        ],
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

  const prompt = buildTextToImagePrompt(input.brand, input.personaId, input.productContext, style);

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
