import { GoogleGenAI } from '@google/genai';
import { logDebug, logError } from '@/lib/app-log';

const MODEL_CHAIN = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
];

export interface CaptionGenerationInput {
  brand: string;
  channels: string[]; // 'facebook' | 'instagram'
  productContext?: string;
  imageBase64?: string; // base64 data URL of the generated creative image
}

interface ModelError {
  status?: number;
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const s = (error as ModelError).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

function buildSystemPrompt(brand: string, channels: string[], hasImage: boolean): string {
  const forInstagram = channels.includes('instagram');
  const forFacebook = channels.includes('facebook');

  const channelGuidance = [
    forInstagram && 'Instagram: punchy, visual, ends with 3-5 relevant hashtags.',
    forFacebook && 'Facebook: slightly longer, conversational, no hashtags needed.',
  ]
    .filter(Boolean)
    .join(' ');

  const imageNote = hasImage
    ? `\nIMPORTANT: I am providing a campaign image. Analyze the image carefully — describe the outfit, the model, the setting, and the mood you see. Your captions MUST match what is visually shown in the image. Reference specific visual details (colours, fabric, setting, model's pose/mood) to make the captions authentic and specific.`
    : '';

  return `You are a social media copywriter for ${brand}, a Sri Lankan women's clothing brand known for stylish, quality garments at accessible prices.

Brand tone: warm, aspirational, feminine, confident — like a knowledgeable friend who loves fashion.
${imageNote}
Task: Write exactly 3 distinct social media captions for the brand's post. Return ONLY a JSON array of 3 strings, no other text.

Channel guidance: ${channelGuidance}

Rules:
- Each caption must be different in angle (e.g. product-focused, lifestyle, urgency/offer).
- Keep captions concise: 1-3 sentences + call to action.
- Use natural, conversational language. No corporate jargon.
- Emojis are encouraged but not excessive (2-4 per caption).
- If channels include Instagram, at least one caption should end with hashtags.
- Reference specific garment details (colour, pattern, fabric, length) — do NOT be generic.
- Never mention competitors. Never make false claims about pricing or stock.
- Output format: ["caption one", "caption two", "caption three"]`;}

function buildUserPrompt(input: CaptionGenerationInput): string {
  if (input.productContext?.trim()) {
    return `Context for this post: ${input.productContext.trim()}

Generate 3 caption variations.`;
  }
  return `Generate 3 general brand caption variations for ${input.brand}.`;
}

function parseCaptions(raw: string): string[] {
  const trimmed = raw.trim();
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function generateCaptions(input: CaptionGenerationInput): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildFallbackCaptions(input.brand);
  }

  const ai = new GoogleGenAI({ apiKey });
  const hasImage = !!(input.imageBase64);
  const systemInstruction = buildSystemPrompt(input.brand, input.channels, hasImage);
  const userText = buildUserPrompt(input);

  // Build multimodal content parts when an image is available
  const contentParts: any[] = [];

  if (hasImage && input.imageBase64) {
    // Extract base64 data and mime type from data URL
    const match = input.imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      contentParts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2],
        },
      });
      logDebug('CaptionGen', 'Attached campaign image for vision-aware caption generation.');
    }
  }

  contentParts.push({ text: userText });

  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    try {
      logDebug('CaptionGen', `Trying model ${model}${hasImage ? ' (with image)' : ''}.`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: contentParts }],
        config: { systemInstruction },
      });
      const text = response.text ?? '';
      const captions = parseCaptions(text);
      if (captions.length > 0) {
        logDebug('CaptionGen', `Got ${captions.length} captions from ${model}.`);
        return captions;
      }
      logDebug('CaptionGen', `Parse failed for ${model}, raw: ${text.slice(0, 120)}`);
    } catch (error: unknown) {
      const status = getErrorStatus(error);
      if ((status === 429 || status === 503 || status === 404) && i < MODEL_CHAIN.length - 1) {
        logDebug('CaptionGen', `${model} returned ${status}; falling back.`);
        continue;
      }
      logError('CaptionGen', 'Caption generation error.', error);
    }
  }

  return buildFallbackCaptions(input.brand);
}

function buildFallbackCaptions(brand: string): string[] {
  return [
    `Elevate your everyday look with ${brand}. ✨ Shop the latest collection — link in bio!`,
    `New arrivals just dropped at ${brand}! 🛍️ Quality styles you'll reach for again and again. DM us to order.`,
    `Style meets comfort at ${brand}. 💕 Because you deserve to feel amazing every day. Shop now — limited pieces available!`,
  ];
}
