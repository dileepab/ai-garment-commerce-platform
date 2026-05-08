import { GoogleGenAI } from '@google/genai';
import { logDebug, logError, logWarn } from '@/lib/app-log';

export type CustomerLanguage = 'english' | 'sinhala' | 'tamil';

interface LanguageResolution {
  language: CustomerLanguage;
  detectedLanguage: CustomerLanguage | null;
  isExplicitPreferenceRequest: boolean;
}

const TEXT_MODEL_CHAIN = [
  process.env.GEMINI_TEXT_MODEL,
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
].filter((model, index, models): model is string => Boolean(model) && models.indexOf(model) === index);

const SINHALA_SCRIPT_RE = /[\u0D80-\u0DFF]/;
const TAMIL_SCRIPT_RE = /[\u0B80-\u0BFF]/;
const SINHALA_ROMAN_RE =
  /\b(sinhala|sinhalese|sinhalen|singhala|singhalen|kohomada|kohoma|karanne|karanna|ganna|ganne|puluwanda|puluwan|mata|mama|oyala|oyage|denna|danna|kiyanna|ona|one|thiyenawada|tiyenawada|keeyada|ganan|milada)\b/i;
const TAMIL_ROMAN_RE =
  /\b(tamil|thamizh|thamil|tamilil|eppadi|epdi|irukka|irukkaa|venum|vendaum|vangurathu|vaanga|order panna|vilai|evlo|evvalavu|size enna|color enna)\b/i;
const ENGLISH_HINT_RE =
  /\b(english|price|size|color|order|buy|available|delivery|payment|cancel|change|address|phone|thanks|hello|hi)\b/i;

const SINHALA_PREFERENCE_RE =
  /\b(sinhala|sinhalese|sinhalen|singhala|singhalen)\b/i;
const TAMIL_PREFERENCE_RE = /\b(tamil|thamizh|thamil|tamilil)\b/i;
const ENGLISH_PREFERENCE_RE = /\b(english|ingrisi|ingreesi)\b/i;
const LANGUAGE_REQUEST_RE =
  /\b(can you|could you|please|pls|puluwanda|puluwan|danna|kiyanna|reply|send|type|speak|talk|language|basa|baasa|mozhi)\b/i;

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }

  return undefined;
}

export function detectCustomerLanguage(message: string): CustomerLanguage | null {
  const normalized = message.trim();

  if (!normalized) {
    return null;
  }

  if (SINHALA_SCRIPT_RE.test(normalized)) {
    return 'sinhala';
  }

  if (TAMIL_SCRIPT_RE.test(normalized)) {
    return 'tamil';
  }

  if (TAMIL_ROMAN_RE.test(normalized) && !SINHALA_ROMAN_RE.test(normalized)) {
    return 'tamil';
  }

  if (SINHALA_ROMAN_RE.test(normalized)) {
    return 'sinhala';
  }

  if (ENGLISH_HINT_RE.test(normalized)) {
    return 'english';
  }

  return null;
}

export function resolveCustomerLanguage(
  message: string,
  previousLanguage: CustomerLanguage = 'english'
): LanguageResolution {
  const detectedLanguage = detectCustomerLanguage(message);
  const normalized = message.trim();
  const explicitLanguage =
    SINHALA_PREFERENCE_RE.test(normalized)
      ? 'sinhala'
      : TAMIL_PREFERENCE_RE.test(normalized)
        ? 'tamil'
        : ENGLISH_PREFERENCE_RE.test(normalized)
          ? 'english'
          : null;
  const isExplicitPreferenceRequest = Boolean(
    explicitLanguage &&
      (LANGUAGE_REQUEST_RE.test(normalized) || normalized.split(/\s+/).length <= 5)
  );

  return {
    language: explicitLanguage || detectedLanguage || previousLanguage || 'english',
    detectedLanguage,
    isExplicitPreferenceRequest,
  };
}

export function isLanguagePreferenceOnlyMessage(message: string): boolean {
  const normalized = message.trim();

  if (!normalized) {
    return false;
  }

  const hasPreference =
    SINHALA_PREFERENCE_RE.test(normalized) ||
    TAMIL_PREFERENCE_RE.test(normalized) ||
    ENGLISH_PREFERENCE_RE.test(normalized);

  if (!hasPreference) {
    return false;
  }

  const businessIntentRe =
    /\b(price|size|color|order|buy|available|delivery|payment|cancel|change|address|phone|top|dress|pant|skirt|shirt|item|product|rs|keeyada|ganan|milada|vilai|evlo|venum|ganna|ganne|karanne)\b/i;

  return !businessIntentRe.test(normalized);
}

export function buildLanguagePreferenceAcknowledgement(language: CustomerLanguage): string {
  if (language === 'sinhala') {
    return 'ඔව්, පුළුවන්. මෙතැන් සිට මම සිංහලෙන් උදව් කරන්නම්.';
  }

  if (language === 'tamil') {
    return 'ஆம், முடியும். இனிமேல் நான் தமிழில் உதவி செய்கிறேன்.';
  }

  return 'Sure. I will continue in English.';
}

export function getCarouselButtonTitle(language: CustomerLanguage): string {
  if (language === 'sinhala') {
    return 'ඇණවුම් කරන්න';
  }

  if (language === 'tamil') {
    return 'ஆர்டர் செய்';
  }

  return 'Order Now';
}

export function formatCarouselSubtitle(
  product: { sizes: string; colors: string },
  language: CustomerLanguage
): string {
  if (language === 'sinhala') {
    return `ප්‍රමාණ: ${product.sizes} | වර්ණ: ${product.colors}`;
  }

  if (language === 'tamil') {
    return `அளவுகள்: ${product.sizes} | நிறங்கள்: ${product.colors}`;
  }

  return `Sizes: ${product.sizes} | Colors: ${product.colors}`;
}

function localizeFallback(reply: string, language: CustomerLanguage): string {
  if (language === 'english') {
    return reply;
  }

  if (language === 'sinhala') {
    return reply
      .replace('We currently have the following items available:', 'දැනට අපට තිබෙන භාණ්ඩ:')
      .replaceAll('Sizes:', 'ප්‍රමාණ:')
      .replaceAll('Sizes ', 'ප්‍රමාණ ')
      .replaceAll('Colors:', 'වර්ණ:')
      .replaceAll('Colors ', 'වර්ණ ')
      .replaceAll('Available stock:', 'තිබෙන ප්‍රමාණය:')
      .replaceAll('Please send the item name', 'කරුණාකර භාණ්ඩයේ නම එවන්න')
      .replaceAll('I will share the correct details for it.', 'මම එහි නිවැරදි විස්තර එවන්නම්.')
      .replaceAll('Sorry, I did not quite catch that.', 'සමාවෙන්න, මට ඒක පැහැදිලිව තේරුණේ නැහැ.')
      .replaceAll("Sorry, I didn't quite catch that.", 'සමාවෙන්න, මට ඒක පැහැදිලිව තේරුණේ නැහැ.');
  }

  return reply
    .replace('We currently have the following items available:', 'தற்போது எங்களிடம் உள்ள பொருட்கள்:')
    .replaceAll('Sizes:', 'அளவுகள்:')
    .replaceAll('Sizes ', 'அளவுகள் ')
    .replaceAll('Colors:', 'நிறங்கள்:')
    .replaceAll('Colors ', 'நிறங்கள் ')
    .replaceAll('Available stock:', 'கையிருப்பு:')
    .replaceAll('Please send the item name', 'தயவுசெய்து பொருளின் பெயரை அனுப்புங்கள்')
    .replaceAll('I will share the correct details for it.', 'அதற்கான சரியான விவரங்களை அனுப்புகிறேன்.')
    .replaceAll('Sorry, I did not quite catch that.', 'மன்னிக்கவும், அது தெளிவாக புரியவில்லை.')
    .replaceAll("Sorry, I didn't quite catch that.", 'மன்னிக்கவும், அது தெளிவாக புரியவில்லை.');
}

export async function localizeReplyWithGemini(
  reply: string | null,
  language: CustomerLanguage
): Promise<string | null> {
  if (!reply || language === 'english') {
    return reply;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || process.env.CHAT_TEST_MODE === '1') {
    return localizeFallback(reply, language);
  }

  const languageName = language === 'sinhala' ? 'Sinhala' : 'Tamil';
  const scriptInstruction =
    language === 'sinhala'
      ? 'Use natural conversational Sinhala script, not romanized Sinhala.'
      : 'Use natural conversational Tamil script, not romanized Tamil.';
  const prompt = `Translate this customer-service reply into ${languageName}.

Rules:
- ${scriptInstruction}
- Keep product names, brand names, order IDs, prices, phone numbers, URLs, sizes, colors, and code-like values exactly as written.
- Keep line breaks and bullet/list structure.
- Do not add new details.
- Output only the translated reply.

Reply:
${reply}`;

  const ai = new GoogleGenAI({ apiKey });

  for (let index = 0; index < TEXT_MODEL_CHAIN.length; index += 1) {
    const model = TEXT_MODEL_CHAIN[index];

    try {
      logDebug('Chat Language', `Trying Gemini text localization model ${model}.`, {
        language,
      });
      const response = await ai.models.generateContent({
        model,
        contents: [{ text: prompt }],
        config: {
          temperature: 0.2,
        },
      });
      const localized = response.text?.trim();

      if (localized) {
        return localized;
      }
    } catch (error) {
      const status = getErrorStatus(error);

      if ((status === 429 || status === 503 || status === 404) && index < TEXT_MODEL_CHAIN.length - 1) {
        logWarn('Chat Language', `Gemini text localization model ${model} failed; trying fallback.`, {
          language,
          status,
          nextModel: TEXT_MODEL_CHAIN[index + 1],
        });
        continue;
      }

      logError('Chat Language', 'Gemini text localization failed; using deterministic fallback.', error);
      break;
    }
  }

  return localizeFallback(reply, language);
}
