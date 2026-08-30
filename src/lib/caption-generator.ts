import { GoogleGenAI } from '@google/genai';
import { logDebug, logError } from '@/lib/app-log';

const MODEL_CHAIN = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];

export interface CaptionGenerationInput {
  brand: string;
  channels: string[]; // 'facebook' | 'instagram' | 'tiktok'
  productContext?: string;
  // Either a base64 data URL or an http(s) URL of the campaign image.
  // Creatives stored in blob storage arrive as the latter.
  imageBase64?: string;
  // Every image in the post. A multi-colour carousel needs all of them, or the
  // model writes copy about whichever single image it was shown.
  images?: string[];
  // Set when the post is about one product, so the click-to-WhatsApp link can
  // be prefilled with its code. Left unset for multi-product posts.
  itemCode?: string | null;
  // Every code in the post. A multi-product post prefills with all of them, so
  // the first message still says which items the customer was looking at.
  itemCodes?: Array<string | null | undefined> | null;
  productName?: string | null;
}

// Sending every frame of a large carousel costs tokens without adding much, so
// cap it at the point where the model has seen the range.
const MAX_CAPTION_IMAGES = 4;

// Resolves every supplied image, de-duplicated and capped.
async function buildImageParts(input: CaptionGenerationInput): Promise<CaptionContentPart[]> {
  const sources = [...new Set([...(input.images ?? []), input.imageBase64]
    .map(s => s?.trim())
    .filter((s): s is string => Boolean(s)))].slice(0, MAX_CAPTION_IMAGES);

  const parts = await Promise.all(sources.map(src => buildImagePart(src)));
  return parts.filter((p): p is CaptionContentPart => p !== null);
}

// Captions are written from what the image actually shows, so a blob-hosted
// creative has to be fetched and inlined before the model can see it.
async function buildImagePart(image: string | undefined): Promise<CaptionContentPart | null> {
  const value = image?.trim();
  if (!value) return null;

  const dataUrl = value.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrl) {
    return { inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } };
  }

  if (!/^https?:\/\//i.test(value)) return null;

  try {
    const res = await fetch(value);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const mimeType = (res.headers.get('content-type') ?? 'image/png').split(';')[0].trim();
    if (!mimeType.startsWith('image/')) return null;
    const buffer = await res.arrayBuffer();
    return { inlineData: { mimeType, data: Buffer.from(buffer).toString('base64') } };
  } catch (error) {
    logError('CaptionGen', 'Could not fetch campaign image; writing captions without it.', error);
    return null;
  }
}

interface ModelError {
  status?: number;
}

type CaptionContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const s = (error as ModelError).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

const CHANNEL_GUIDANCE: Record<string, string> = {
  instagram: 'punchy and visual, 1-2 short sentences, ends with 3-5 relevant hashtags',
  facebook: 'slightly longer and conversational, 2-3 sentences, no hashtags',
  tiktok: 'short, energetic creator-style copy: a strong hook, 2-4 short lines, one clear call to action, then 3-5 discovery hashtags',
};

function channelLabel(channel: string): string {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function buildSystemPrompt(brand: string, channels: string[], hasImage: boolean): string {
  const forInstagram = channels.includes('instagram');
  const forFacebook = channels.includes('facebook');
  const forTikTok = channels.includes('tiktok');

  const channelGuidance = [
    forInstagram && 'Instagram: punchy, visual, ends with 3-5 relevant hashtags.',
    forFacebook && 'Facebook: slightly longer, conversational, no hashtags needed.',
    forTikTok && 'TikTok: short, energetic creator-style copy with a strong hook, 2-4 short lines, one call to action, and 3-5 discovery hashtags.',
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
- If channels include TikTok, keep the copy under 4,000 characters and include a strong opening hook.
- Reference specific garment details (colour, pattern, fabric, length) — do NOT be generic.
- Treat the supplied product context as private source material. Weave useful facts naturally into the copy; never reproduce labels such as "Item Name", "Item Code", "Available Sizes", "Available Colors", or "Item Price".
- Mention each product fact at most once. Do not append a catalogue, specification, or inventory block.
- Never mention competitors. Never make false claims about pricing or stock.
- Output format: ["caption one", "caption two", "caption three"]`;}

// Facebook and Instagram reward different copy, so ask for both in one call.
// A single call keeps the campaign angle coherent across channels and costs
// the same as generating for one.
function buildPerChannelSystemPrompt(brand: string, channels: string[], hasImage: boolean): string {
  const imageNote = hasImage
    ? `\nIMPORTANT: I am providing a campaign image. Analyze it carefully and make every caption match what is visually shown — reference specific colours, fabric, setting, and the model's pose or mood.`
    : '';

  const perChannel = channels
    .map(channel => `- "${channel}": ${CHANNEL_GUIDANCE[channel] ?? 'clear, on-brand copy with a call to action'}`)
    .join('\n');

  const shape = channels
    .map(channel => `  "${channel}": ["caption one", "caption two", "caption three"]`)
    .join(',\n');

  return `You are a social media copywriter for ${brand}, a Sri Lankan women's clothing brand known for stylish, quality garments at accessible prices.

Brand tone: warm, aspirational, feminine, confident — like a knowledgeable friend who loves fashion.
${imageNote}
Task: Write 3 distinct captions for EACH channel listed below. The same campaign idea, rewritten to suit each channel — not copy-pasted between them.

Channels:
${perChannel}

Rules:
- Within a channel, each caption must take a different angle (product-focused, lifestyle, urgency/offer).
- Use natural, conversational language. No corporate jargon.
- Emojis are encouraged but not excessive (2-4 per caption).
- Reference specific garment details (colour, pattern, fabric, length) — do NOT be generic.
- Treat the supplied product context as private source material. Weave useful facts naturally into the copy; never reproduce labels such as "Item Name", "Item Code", "Available Sizes", "Available Colors", or "Item Price".
- Mention each product fact at most once. Do not append a catalogue, specification, or inventory block.
- For TikTok specifically, use a strong first-line hook, 2-4 short lines, and finish with 3-5 relevant discovery hashtags.
- Do not mention price or available sizes in TikTok copy; GarmentOS appends those verified product facts from the database.
- Do not tell TikTok customers to visit the website, use the link in bio, or send a DM; GarmentOS appends the correct WhatsApp ordering call to action.
- Never mention competitors. Never make false claims about pricing or stock.
- Return ONLY this JSON object, no other text:
{
${shape}
}`;
}

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
  const imageParts = await buildImageParts(input);
  const hasImage = imageParts.length > 0;
  const systemInstruction = buildSystemPrompt(input.brand, input.channels, hasImage);
  const userText = buildUserPrompt(input);

  // Build multimodal content parts when images are available
  const contentParts: CaptionContentPart[] = [...imageParts];
  if (hasImage) {
    logDebug('CaptionGen', `Attached ${imageParts.length} campaign image(s) for vision-aware caption generation.`);
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

// ── Per-channel generation ───────────────────────────────────────────────────

export type CaptionsByChannel = Record<string, string[]>;

function parseCaptionsByChannel(raw: string, channels: string[]): CaptionsByChannel {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return {};

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const result: CaptionsByChannel = {};
    for (const channel of channels) {
      const value = (parsed as Record<string, unknown>)[channel];
      if (!Array.isArray(value)) continue;
      const captions = value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, 3);
      if (captions.length > 0) result[channel] = captions;
    }
    return result;
  } catch {
    return {};
  }
}

// Returns one caption set per requested channel. Channels the model skipped
// fall back to the shared generator so the caller always gets something usable.
export async function generateCaptionsByChannel(
  input: CaptionGenerationInput,
): Promise<CaptionsByChannel> {
  const channels = input.channels.map(c => c.trim()).filter(Boolean);
  if (channels.length === 0) return {};

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Object.fromEntries(channels.map(c => [c, buildFallbackCaptions(input.brand)]));
  }

  const ai = new GoogleGenAI({ apiKey });
  const imageParts = await buildImageParts(input);
  const hasImage = imageParts.length > 0;
  const systemInstruction = buildPerChannelSystemPrompt(input.brand, channels, hasImage);

  const contentParts: CaptionContentPart[] = [...imageParts];
  if (hasImage) {
    logDebug('CaptionGen', `Attached ${imageParts.length} campaign image(s) for vision-aware per-channel captions.`);
  }
  contentParts.push({
    text: `${buildUserPrompt(input)}\n\nChannels to write for: ${channels.map(channelLabel).join(', ')}.`,
  });

  let byChannel: CaptionsByChannel = {};

  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    try {
      logDebug('CaptionGen', `Per-channel captions via ${model}${hasImage ? ' (with image)' : ''}.`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: contentParts }],
        config: { systemInstruction },
      });
      byChannel = parseCaptionsByChannel(response.text ?? '', channels);
      if (Object.keys(byChannel).length > 0) break;
      logDebug('CaptionGen', `Per-channel parse failed for ${model}.`);
    } catch (error: unknown) {
      const status = getErrorStatus(error);
      if ((status === 429 || status === 503 || status === 404) && i < MODEL_CHAIN.length - 1) {
        logDebug('CaptionGen', `${model} returned ${status}; falling back.`);
        continue;
      }
      logError('CaptionGen', 'Per-channel caption generation error.', error);
      break;
    }
  }

  // Any channel the model omitted still needs copy.
  const missing = channels.filter(channel => !byChannel[channel]?.length);
  if (missing.length > 0) {
    const shared = await generateCaptions({ ...input, channels: missing });
    for (const channel of missing) byChannel[channel] = shared;
  }

  return byChannel;
}
