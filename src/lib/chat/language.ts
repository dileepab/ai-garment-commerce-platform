import { GoogleGenAI } from '@google/genai';
import { logDebug, logError, logWarn } from '@/lib/app-log';
import { matchGreeting } from '@/lib/chat/greeting-variants';

export type CustomerLanguage = 'english' | 'sinhala' | 'tamil';
export type CustomerScriptStyle = 'native' | 'roman';

interface LanguageResolution {
  language: CustomerLanguage;
  detectedLanguage: CustomerLanguage | null;
  isExplicitPreferenceRequest: boolean;
}

const TEXT_MODEL_CHAIN = [
  process.env.GEMINI_TEXT_MODEL,
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.5-flash',
].filter((model, index, models): model is string => Boolean(model) && models.indexOf(model) === index);

const SINHALA_SCRIPT_RE = /[\u0D80-\u0DFF]/;
const TAMIL_SCRIPT_RE = /[\u0B80-\u0BFF]/;
const SINHALA_ROMAN_RE =
  /\b(sinhala|sinhalese|sinhalen|singhala|singhalen|kohomada|kohoma|karanne|karanna|ganna|ganne|puluwanda|puluwan|mata|mama|ape|oyala|oyage|denna|danna|kiyanna|ona|mona|monawa|monawada|monawath|thiyana|thiyena|tiyana|tiyena|thiyenne|thiyenawada|tiyenawada|thiyanawada|adum|edum|anduma|koheda|keeyada|ganan|milada|mokakda|mokadda|mokada|penne|nane)\b/i;
const TAMIL_ROMAN_RE =
  /\b(tamil|thamizh|thamil|tamilil|vanakkam|nandri|romba|enakku|naan|eppadi|epdi|irukka|irukkaa|venum|vendaum|vangurathu|vaanga|podanum|vaanganum|order panna|vilai|evlo|evvalavu|size enna|color enna)\b/i;
const ENGLISH_HINT_RE =
  /\b(english|where|what|when|how|who|does|do|can|could|have|has|send|via|courier|price|cost|charge|fee|size|color|order|buy|available|delivery|shipping|payment|cancel|change|address|phone|thanks|hello|hi|shop|store|outlet|location|located|branch|branches|open|opening|close|closing|hours|item|items|product|products|details|fabric|slit|zip|dress|gown|top|skirt|pants|interested|support|contact|chat)\b/i;

const SINHALA_PREFERENCE_RE =
  /\b(sinhala|sinhalese|sinhalen|singhala|singhalen)\b|සිංහලෙන්|සිංහල භාෂාවෙන්/i;
const TAMIL_PREFERENCE_RE = /\b(tamil|thamizh|thamil|tamilil)\b|தமிழில்|தமிழ் மொழியில்/i;
const ENGLISH_PREFERENCE_RE = /\b(english|ingrisi|ingreesi)\b/i;
const LANGUAGE_REQUEST_RE =
  /\b(can you|could you|please|pls|puluwanda|puluwan|danna|kiyanna|reply|send|type|speak|talk|language|basa|baasa|mozhi)\b|කියන්න|පුළුවන්ද|පිළිතුරු|பதில்|சொல்ல|முடியுமா/i;

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }

  return undefined;
}

export function formatConversationHistoryForPrompt(
  historyNewestFirst: Array<{ role: string; message: string }>
): string {
  const recentHistory = historyNewestFirst
    .slice(0, 8)
    .reverse()
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'Customer'}: ${entry.message}`)
    .join('\n');

  return recentHistory || 'No prior messages available.';
}

function isUnsafeConversationalRewrite(rewritten: string): boolean {
  return /\[(?:insert|placeholder|add|image|photo|size chart)[^\]]*\]/i.test(rewritten);
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

export function detectCustomerScriptStyle(
  message: string,
  language?: CustomerLanguage | null
): CustomerScriptStyle | null {
  const normalized = message.trim();

  if (!normalized) {
    return null;
  }

  if (SINHALA_SCRIPT_RE.test(normalized) || TAMIL_SCRIPT_RE.test(normalized)) {
    return 'native';
  }

  const resolvedLanguage = language || detectCustomerLanguage(normalized);

  if (resolvedLanguage === 'sinhala' && SINHALA_ROMAN_RE.test(normalized)) {
    return 'roman';
  }

  if (resolvedLanguage === 'tamil' && TAMIL_ROMAN_RE.test(normalized)) {
    return 'roman';
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
    /\b(price|size|color|order|buy|available|delivery|payment|cancel|change|address|phone|top|dress|pant|skirt|shirt|item|product|rs|keeyada|ganan|milada|vilai|evlo|venum|ganna|ganne|karanne)\b|මිල|ගාන|ප්‍රමාණ|පාට|ඇඳුම|ඇදුම|ඇඳුම්|ඇදුම්|තියෙන|තිබෙන|ඇණවුම|ගෙවීම්|ඩිලිවරි|விலை|அளவு|நிறம்|உடை|ஆடை|கிடைக்க|ஆர்டர்|கட்டணம்|டெலிவரி|பரிந்துரை/i;

  return !businessIntentRe.test(normalized);
}

export function buildLanguagePreferenceAcknowledgement(
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): string {
  if (language === 'sinhala') {
    return scriptStyle === 'roman'
      ? 'Ow, puluwan. Methanin passe mama Roman Sinhala walin help karannam.'
      : 'ඔව්, පුළුවන්. මෙතැන් සිට මම සිංහලෙන් උදව් කරන්නම්.';
  }

  if (language === 'tamil') {
    return scriptStyle === 'roman'
      ? 'Aam, mudiyum. Inime naan Roman Tamil-la help panren.'
      : 'ஆம், முடியும். இனிமேல் நான் தமிழில் உதவி செய்கிறேன்.';
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

export function getCarouselDetailsButtonTitle(language: CustomerLanguage): string {
  if (language === 'sinhala') {
    return 'විස්තර';
  }

  if (language === 'tamil') {
    return 'விபரம்';
  }

  return 'Details';
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

function localizeFallback(
  reply: string,
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): string {
  if (language === 'english') {
    return reply;
  }

  if (language === 'sinhala' && scriptStyle === 'roman') {
    return reply
      .replace('We currently have the following items available:', 'Danata apita me items thiyenawa:')
      .replaceAll('Fabric:', 'Redda:')
      .replaceAll('In stock now.', 'Danata stock thiyenawa.')
      .replaceAll('Out of stock right now.', 'Danata stock ivarai.')
      .replace('At the moment this chat is set up for online orders.', 'Danata me chat eka online orders walata set karala thiyenne.')
      .replace('I do not have a confirmed branch list saved here yet.', 'Confirm karapu branch list ekak danata save wela naha.')
      .replace('You can message us here for item details, delivery, COD, or orders.', 'Item details, delivery, COD, saha orders gana me chat ekenma ahanna puluwan.')
      .replace('For store location or branch details,', 'Store location hari branch details walata,')
      .replaceAll('Please send the item name', 'Item eke nama ewanawada')
      .replaceAll('I will share the correct details for it.', 'Mama eka gana hari details dennam.')
      .replaceAll('Sorry, I did not quite catch that.', 'Sorry, mata eka hariyata therune naha.')
      .replaceAll("Sorry, I didn't quite catch that.", 'Sorry, mata eka hariyata therune naha.');
  }

  if (language === 'tamil' && scriptStyle === 'roman') {
    return reply
      .replace('We currently have the following items available:', 'Ippo engal kitta indha items irukku:')
      .replaceAll('Fabric:', 'Thuni:')
      .replaceAll('In stock now.', 'Ippo stock irukku.')
      .replaceAll('Out of stock right now.', 'Ippo stock illa.')
      .replaceAll('Please send the item name', 'Item name anuppunga')
      .replaceAll('I will share the correct details for it.', 'Athoda correct details anuppuren.')
      .replaceAll('Sorry, I did not quite catch that.', 'Sorry, adhu enakku clear-a puriyala.')
      .replaceAll("Sorry, I didn't quite catch that.", 'Sorry, adhu enakku clear-a puriyala.');
  }

  if (language === 'sinhala') {
    return reply
      .replace('We currently have the following items available:', 'දැනට අපට තිබෙන භාණ්ඩ:')
      .replaceAll('Fabric:', 'රෙදි වර්ගය:')
      .replaceAll('Sizes:', 'ප්‍රමාණ:')
      .replaceAll('Sizes ', 'ප්‍රමාණ ')
      .replaceAll('Colors:', 'වර්ණ:')
      .replaceAll('Colors ', 'වර්ණ ')
      .replaceAll('In stock now.', 'දැනට තිබෙනවා.')
      .replaceAll('Out of stock right now.', 'දැනට තිබෙන්නේ නැහැ.')
      .replace('At the moment this chat is set up for online orders.', 'දැනට මෙම chat එක online orders සඳහා සකසා ඇත.')
      .replace('I do not have a confirmed branch list saved here yet.', 'තහවුරු කළ branch ලැයිස්තුවක් මෙහි තවම save කර නැහැ.')
      .replace('You can message us here for item details, delivery, COD, or orders.', 'Item details, delivery, COD, හෝ orders ගැන ඔබට මෙතැනින්ම message කළ හැක.')
      .replace('For store location or branch details,', 'Store location හෝ branch විස්තර සඳහා,')
      .replaceAll('Please send the item name', 'කරුණාකර භාණ්ඩයේ නම එවන්න')
      .replaceAll('I will share the correct details for it.', 'මම එහි නිවැරදි විස්තර එවන්නම්.')
      .replaceAll('Sorry, I did not quite catch that.', 'සමාවෙන්න, මට ඒක පැහැදිලිව තේරුණේ නැහැ.')
      .replaceAll("Sorry, I didn't quite catch that.", 'සමාවෙන්න, මට ඒක පැහැදිලිව තේරුණේ නැහැ.');
  }

  return reply
    .replace('We currently have the following items available:', 'தற்போது எங்களிடம் உள்ள பொருட்கள்:')
    .replaceAll('Fabric:', 'துணி:')
    .replaceAll('Sizes:', 'அளவுகள்:')
    .replaceAll('Sizes ', 'அளவுகள் ')
    .replaceAll('Colors:', 'நிறங்கள்:')
    .replaceAll('Colors ', 'நிறங்கள் ')
    .replaceAll('In stock now.', 'இப்போது கையிருப்பில் உள்ளது.')
    .replaceAll('Out of stock right now.', 'இப்போது கையிருப்பில் இல்லை.')
    .replace('At the moment this chat is set up for online orders.', 'தற்போது இந்த chat online orders காக அமைக்கப்பட்டுள்ளது.')
    .replace('I do not have a confirmed branch list saved here yet.', 'உறுதிப்படுத்தப்பட்ட கிளை பட்டியல் இங்கே இன்னும் சேமிக்கப்படவில்லை.')
    .replace('You can message us here for item details, delivery, COD, or orders.', 'Item details, delivery, COD, அல்லது orders பற்றி இங்கே message செய்யலாம்.')
    .replace('For store location or branch details,', 'Store location அல்லது கிளை விவரங்களுக்கு,')
    .replaceAll('Please send the item name', 'தயவுசெய்து பொருளின் பெயரை அனுப்புங்கள்')
    .replaceAll('I will share the correct details for it.', 'அதற்கான சரியான விவரங்களை அனுப்புகிறேன்.')
    .replaceAll('Sorry, I did not quite catch that.', 'மன்னிக்கவும், அது தெளிவாக புரியவில்லை.')
    .replaceAll("Sorry, I didn't quite catch that.", 'மன்னிக்கவும், அது தெளிவாக புரியவில்லை.');
}

const EMPTY_CATALOG_REPLY =
  'We do not have any items listed right now. New products will be available soon—follow our page for updates.';

const EMPTY_CATALOG_REPLY_SINHALA =
  'දැනට අපගේ catalog එකේ භාණ්ඩ කිසිවක් ලැයිස්තුගත කර නැහැ. අලුත් භාණ්ඩ ළඟදීම එක් කරනු ඇත—updates සඳහා අපගේ page එක follow කරන්න.';

const EMPTY_CATALOG_REPLY_TAMIL =
  'தற்போது எங்கள் catalog-ல் எந்தப் பொருட்களும் பட்டியலிடப்படவில்லை. புதிய பொருட்கள் விரைவில் சேர்க்கப்படும்—updates-க்கு எங்கள் page-ஐ follow செய்யுங்கள்.';

const EMPTY_CATALOG_REPLY_ROMAN_SINHALA =
  'Danata catalog eke items list karala naha. Aluth items langadima add karanawa—updates walata page eka follow karanna.';

const EMPTY_CATALOG_REPLY_ROMAN_TAMIL =
  'Ippo catalog-la items list pannala. Pudhu items seekiram add pannuvom—updates-ku page-a follow pannunga.';

function localizeBusinessDayEstimate(estimate: string, language: CustomerLanguage): string {
  if (language === 'sinhala') {
    return estimate
      .replace('1-2 business days', 'දින 1-2 ක්')
      .replace('2-3 business days', 'දින 2-3 ක්');
  }

  if (language === 'tamil') {
    return estimate
      .replace('1-2 business days', '1-2 வேலை நாட்கள்')
      .replace('2-3 business days', '2-3 வேலை நாட்கள்');
  }

  return estimate;
}

function localizeDeliveryReply(
  reply: string,
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): string | null {
  const chargedPreOrderMatch = reply.match(
    /^Delivery to (.+?) costs Rs (\d+)\. Delivery to \1 usually takes (.+?), excluding weekends and Sri Lankan public holidays\. If the order is confirmed on (.+?), the expected delivery window is (.+?) to (.+?)\.$/
  );

  if (chargedPreOrderMatch) {
    const [, address, charge, estimate, referenceDate, earliestDate, latestDate] = chargedPreOrderMatch;
    const localizedEstimate = localizeBusinessDayEstimate(estimate, language);

    if (language === 'sinhala' && scriptStyle === 'roman') {
      return `${address} walata delivery charge eka Rs ${charge}. Delivery eka samanyen ${estimate} yanawa, weekends saha Sri Lankan public holidays nathuwa. ${referenceDate} order eka confirm kaloth, expected delivery window eka ${earliestDate} idan ${latestDate} dakwa.`;
    }

    if (language === 'tamil' && scriptStyle === 'roman') {
      return `${address}-ku delivery charge Rs ${charge}. Delivery usually ${estimate}, weekends-um Sri Lankan public holidays-um thavirthu. ${referenceDate} order confirm pannina, expected delivery window ${earliestDate} mudhal ${latestDate} varai.`;
    }

    if (language === 'sinhala') {
      return `${address} වෙත delivery charge එක Rs ${charge} කි. ${address} වෙත භාරදීම සාමාන්‍යයෙන් ${localizedEstimate} ගතවේ, සති අන්ත සහ ශ්‍රී ලංකා මහජන නිවාඩු දින හැර. ${referenceDate} දින ඇණවුම තහවුරු කළහොත්, අපේක්ෂිත භාරදීමේ කාලය ${earliestDate} සිට ${latestDate} දක්වා වේ.`;
    }

    if (language === 'tamil') {
      return `${address}க்கு delivery charge Rs ${charge}. ${address}க்கு டெலிவரி பொதுவாக ${localizedEstimate} ஆகும், வார இறுதி நாட்கள் மற்றும் இலங்கை பொது விடுமுறை நாட்களை தவிர்த்து. ${referenceDate} அன்று order confirm செய்தால், எதிர்பார்க்கப்படும் delivery window ${earliestDate} முதல் ${latestDate} வரை இருக்கும்.`;
    }
  }

  const chargedWindowMatch = reply.match(
    /^Delivery to (.+?) costs Rs (\d+)\. Delivery to \1 usually takes (.+?), excluding weekends and Sri Lankan public holidays\. The expected delivery window is (.+?) to (.+?)\.$/
  );

  if (chargedWindowMatch) {
    const [, address, charge, estimate, earliestDate, latestDate] = chargedWindowMatch;
    const localizedEstimate = localizeBusinessDayEstimate(estimate, language);

    if (language === 'sinhala' && scriptStyle === 'roman') {
      return `${address} walata delivery charge eka Rs ${charge}. Delivery eka samanyen ${estimate} yanawa, weekends saha Sri Lankan public holidays nathuwa. Expected delivery window eka ${earliestDate} idan ${latestDate} dakwa.`;
    }

    if (language === 'tamil' && scriptStyle === 'roman') {
      return `${address}-ku delivery charge Rs ${charge}. Delivery usually ${estimate}, weekends-um Sri Lankan public holidays-um thavirthu. Expected delivery window ${earliestDate} mudhal ${latestDate} varai.`;
    }

    if (language === 'sinhala') {
      return `${address} වෙත delivery charge එක Rs ${charge} කි. ${address} වෙත භාරදීම සාමාන්‍යයෙන් ${localizedEstimate} ගතවේ, සති අන්ත සහ ශ්‍රී ලංකා මහජන නිවාඩු දින හැර. අපේක්ෂිත භාරදීමේ කාලය ${earliestDate} සිට ${latestDate} දක්වා වේ.`;
    }

    if (language === 'tamil') {
      return `${address}க்கு delivery charge Rs ${charge}. ${address}க்கு டெலிவரி பொதுவாக ${localizedEstimate} ஆகும், வார இறுதி நாட்கள் மற்றும் இலங்கை பொது விடுமுறை நாட்களை தவிர்த்து. எதிர்பார்க்கப்படும் delivery window ${earliestDate} முதல் ${latestDate} வரை இருக்கும்.`;
    }
  }

  const preOrderMatch = reply.match(
    /^Delivery to (.+?) usually takes (.+?), excluding weekends and Sri Lankan public holidays\. If the order is confirmed on (.+?), the expected delivery window is (.+?) to (.+?)\.$/
  );

  if (preOrderMatch) {
    const [, address, estimate, referenceDate, earliestDate, latestDate] = preOrderMatch;
    const localizedEstimate = localizeBusinessDayEstimate(estimate, language);

    if (language === 'sinhala' && scriptStyle === 'roman') {
      return `${address} walata delivery eka samanyen ${estimate} yanawa, weekends saha Sri Lankan public holidays nathuwa. ${referenceDate} order eka confirm kaloth, expected delivery window eka ${earliestDate} idan ${latestDate} dakwa.`;
    }

    if (language === 'tamil' && scriptStyle === 'roman') {
      return `${address}-ku delivery usually ${estimate}, weekends-um Sri Lankan public holidays-um thavirthu. ${referenceDate} order confirm pannina, expected delivery window ${earliestDate} mudhal ${latestDate} varai.`;
    }

    if (language === 'sinhala') {
      return `${address} වෙත භාරදීම සාමාන්‍යයෙන් ${localizedEstimate} ගතවේ, සති අන්ත සහ ශ්‍රී ලංකා මහජන නිවාඩු දින හැර. ${referenceDate} දින ඇණවුම තහවුරු කළහොත්, අපේක්ෂිත භාරදීමේ කාලය ${earliestDate} සිට ${latestDate} දක්වා වේ.`;
    }

    if (language === 'tamil') {
      return `${address}க்கு டெலிவரி பொதுவாக ${localizedEstimate} ஆகும், வார இறுதி நாட்கள் மற்றும் இலங்கை பொது விடுமுறை நாட்களை தவிர்த்து. ${referenceDate} அன்று order confirm செய்தால், எதிர்பார்க்கப்படும் delivery window ${earliestDate} முதல் ${latestDate} வரை இருக்கும்.`;
    }
  }

  const windowMatch = reply.match(
    /^Delivery to (.+?) usually takes (.+?), excluding weekends and Sri Lankan public holidays\. The expected delivery window is (.+?) to (.+?)\.$/
  );

  if (windowMatch) {
    const [, address, estimate, earliestDate, latestDate] = windowMatch;
    const localizedEstimate = localizeBusinessDayEstimate(estimate, language);

    if (language === 'sinhala' && scriptStyle === 'roman') {
      return `${address} walata delivery eka samanyen ${estimate} yanawa, weekends saha Sri Lankan public holidays nathuwa. Expected delivery window eka ${earliestDate} idan ${latestDate} dakwa.`;
    }

    if (language === 'tamil' && scriptStyle === 'roman') {
      return `${address}-ku delivery usually ${estimate}, weekends-um Sri Lankan public holidays-um thavirthu. Expected delivery window ${earliestDate} mudhal ${latestDate} varai.`;
    }

    if (language === 'sinhala') {
      return `${address} වෙත භාරදීම සාමාන්‍යයෙන් ${localizedEstimate} ගතවේ, සති අන්ත සහ ශ්‍රී ලංකා මහජන නිවාඩු දින හැර. අපේක්ෂිත භාරදීමේ කාලය ${earliestDate} සිට ${latestDate} දක්වා වේ.`;
    }

    if (language === 'tamil') {
      return `${address}க்கு டெலிவரி பொதுவாக ${localizedEstimate} ஆகும், வார இறுதி நாட்கள் மற்றும் இலங்கை பொது விடுமுறை நாட்களை தவிர்த்து. எதிர்பார்க்கப்படும் delivery window ${earliestDate} முதல் ${latestDate} வரை இருக்கும்.`;
    }
  }

  return null;
}

function localizeVariantPromptFallback(
  reply: string,
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): string | null {
  const sizeMatch = reply.match(
    /^Please let me know the size you need for (.+?)(?:\. Available sizes: (.+?)\.)?$/
  );
  const colorMatch = reply.match(
    /^Please let me know the color you need for (.+?)(?:\. Available colors: (.+?)\.)?$/
  );

  if (!sizeMatch && !colorMatch) {
    return null;
  }

  const [, sizeProduct, sizeOptions] = sizeMatch ?? [];
  const [, colorProduct, colorOptions] = colorMatch ?? [];

  if (language === 'sinhala' && scriptStyle === 'roman') {
    if (sizeMatch) {
      return `${sizeProduct} ekata ona size eka kiyannako.${
        sizeOptions ? ` Available sizes: ${sizeOptions}.` : ''
      }`;
    }

    return `${colorProduct} ekata ona color eka kiyannako.${
      colorOptions ? ` Available colors: ${colorOptions}.` : ''
    }`;
  }

  if (language === 'tamil' && scriptStyle === 'roman') {
    if (sizeMatch) {
      return `${sizeProduct}-ku venum size-a sollunga.${
        sizeOptions ? ` Available sizes: ${sizeOptions}.` : ''
      }`;
    }

    return `${colorProduct}-ku venum color-a sollunga.${
      colorOptions ? ` Available colors: ${colorOptions}.` : ''
    }`;
  }

  if (language === 'sinhala') {
    if (sizeMatch) {
      return `${sizeProduct} සඳහා ඔබට අවශ්‍ය size එක දන්වන්න.${
        sizeOptions ? ` පවතින sizes: ${sizeOptions}.` : ''
      }`;
    }

    return `${colorProduct} සඳහා ඔබට අවශ්‍ය color එක දන්වන්න.${
      colorOptions ? ` පවතින colors: ${colorOptions}.` : ''
    }`;
  }

  if (language === 'tamil') {
    if (sizeMatch) {
      return `${sizeProduct}க்கு தேவையான size-ஐ தெரிவிக்கவும்.${
        sizeOptions ? ` கிடைக்கும் sizes: ${sizeOptions}.` : ''
      }`;
    }

    return `${colorProduct}க்கு தேவையான color-ஐ தெரிவிக்கவும்.${
      colorOptions ? ` கிடைக்கும் colors: ${colorOptions}.` : ''
    }`;
  }

  return null;
}

function localizeSelectionUpdateReply(
  reply: string,
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): string | null {
  const match = reply.match(/^Got it — I've updated the selection to (.+)\.$/);
  if (!match?.[1]) return null;
  const selection = match[1];

  if (language === 'sinhala') {
    return scriptStyle === 'roman'
      ? `Hari — selection eka ${selection} walata update kala.`
      : `හරි — selection එක ${selection} ලෙස update කළා.`;
  }

  if (language === 'tamil') {
    return scriptStyle === 'roman'
      ? `Sari — selection-a ${selection}-ku update pannitten.`
      : `சரி — selection-ஐ ${selection} என update செய்துவிட்டேன்.`;
  }

  return reply;
}

function localizePaymentReply(
  reply: string,
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): string | null {
  if (!/\b(?:payment methods?|COD|cash on delivery|online transfer)\b/i.test(reply)) {
    return null;
  }

  if (language === 'sinhala' && scriptStyle === 'roman') {
    return reply
      .replace('Yes, COD works for us.', 'Ow, COD puluwan.')
      .replace('COD is not available right now.', 'Danata COD available naha.')
      .replace(/Available payment methods are (.+?)\./, 'Payment karanna puluwan methods: $1.')
      .replace(/Available payment method is (.+?)\./, 'Payment karanna puluwan method eka: $1.');
  }

  if (language === 'sinhala') {
    return reply
      .replace('Yes, COD works for us.', 'ඔව්, COD භාවිතා කළ හැක.')
      .replace('COD is not available right now.', 'දැනට COD ලබා ගත නොහැක.')
      .replace(/Available payment methods are (.+?)\./, 'ලබා ගත හැකි ගෙවීම් ක්‍රම: $1.')
      .replace(/Available payment method is (.+?)\./, 'ලබා ගත හැකි ගෙවීම් ක්‍රමය: $1.');
  }

  if (language === 'tamil' && scriptStyle === 'roman') {
    return reply
      .replace('Yes, COD works for us.', 'Aam, COD irukku.')
      .replace('COD is not available right now.', 'Ippo COD available illa.')
      .replace(/Available payment methods are (.+?)\./, 'Payment panna mudiyum methods: $1.')
      .replace(/Available payment method is (.+?)\./, 'Payment panna mudiyum method: $1.');
  }

  if (language === 'tamil') {
    return reply
      .replace('Yes, COD works for us.', 'ஆம், COD உள்ளது.')
      .replace('COD is not available right now.', 'தற்போது COD கிடைக்கவில்லை.')
      .replace(/Available payment methods are (.+?)\./, 'கிடைக்கும் கட்டண முறைகள்: $1.')
      .replace(/Available payment method is (.+?)\./, 'கிடைக்கும் கட்டண முறை: $1.');
  }

  return reply;
}

function localizeKnownReply(
  reply: string,
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): string | null {
  if (
    reply ===
    'I am doing well, thank you. I can help with available items, sizes, COD, delivery, or an order.'
  ) {
    if (language === 'sinhala') {
      return scriptStyle === 'roman'
        ? 'Mama hondin, sthuthi. Available items, sizes, COD, delivery, hari order ekak gana mama help karannam.'
        : 'මම හොඳින්, ස්තුතියි. තිබෙන භාණ්ඩ, sizes, COD, delivery, හෝ order එකක් ගැන මට උදව් කළ හැක.';
    }

    if (language === 'tamil') {
      return scriptStyle === 'roman'
        ? 'Naan nalla irukken, nandri. Available items, sizes, COD, delivery, illa order pathi help panren.'
        : 'நான் நலமாக இருக்கிறேன், நன்றி. கிடைக்கும் பொருட்கள், sizes, COD, delivery, அல்லது order பற்றி உதவுகிறேன்.';
    }
  }

  if (reply === 'You are welcome. Let me know if there is anything else.') {
    if (language === 'sinhala') {
      return scriptStyle === 'roman'
        ? 'Prashnayak naha. Thawa monawath ona nam kiyannako.'
        : 'ප්‍රශ්නයක් නැහැ. තවත් උදව්වක් අවශ්‍ය නම් කියන්න.';
    }

    if (language === 'tamil') {
      return scriptStyle === 'roman'
        ? 'Parava illa. Vera edhavathu help venumna sollunga.'
        : 'பரவாயில்லை. வேறு ஏதாவது உதவி வேண்டுமெனில் சொல்லுங்கள்.';
    }
  }

  // Every greeting variant carries its own Sinhala and Tamil forms, so wording
  // can vary in English without dropping other languages back to English.
  const greeting = matchGreeting(reply);

  if (greeting) {
    const { namePart, storeName, variant } = greeting;

    if (language === 'sinhala') {
      return scriptStyle === 'roman'
        ? variant.sinhalaRoman(namePart, storeName)
        : variant.sinhala(namePart, storeName);
    }

    if (language === 'tamil') {
      return scriptStyle === 'roman'
        ? variant.tamilRoman(namePart, storeName)
        : variant.tamil(namePart, storeName);
    }
  }

  if (reply !== EMPTY_CATALOG_REPLY) {
    const paragraphReplies = reply.split(/\n\n+/);
    if (paragraphReplies.length > 1) {
      const localizedParagraphs = paragraphReplies.map(
        (paragraph) =>
          localizeSelectionUpdateReply(paragraph, language, scriptStyle) ||
          localizeVariantPromptFallback(paragraph, language, scriptStyle)
      );

      if (localizedParagraphs.every((paragraph): paragraph is string => Boolean(paragraph))) {
        return localizedParagraphs.join('\n\n');
      }
    }

    const [primaryReply, ...additionalReplies] = reply.split(/\n\n+/);
    const localizedDelivery = localizeDeliveryReply(primaryReply, language, scriptStyle);

    if (localizedDelivery) {
      return [
        localizedDelivery,
        ...additionalReplies.map(
          (additionalReply) =>
            localizePaymentReply(additionalReply, language, scriptStyle) ||
            localizeFallback(additionalReply, language, scriptStyle)
        ),
      ].join('\n\n');
    }

    return (
      localizeVariantPromptFallback(reply, language, scriptStyle) ||
      localizePaymentReply(reply, language, scriptStyle)
    );
  }

  if (language === 'sinhala') {
    return scriptStyle === 'roman'
      ? EMPTY_CATALOG_REPLY_ROMAN_SINHALA
      : EMPTY_CATALOG_REPLY_SINHALA;
  }

  if (language === 'tamil') {
    return scriptStyle === 'roman'
      ? EMPTY_CATALOG_REPLY_ROMAN_TAMIL
      : EMPTY_CATALOG_REPLY_TAMIL;
  }

  return reply;
}

export async function localizeReplyWithGemini(
  reply: string | null,
  language: CustomerLanguage,
  scriptStyle: CustomerScriptStyle = 'native'
): Promise<string | null> {
  if (!reply || language === 'english') {
    return reply;
  }

  const knownReply = localizeKnownReply(reply, language, scriptStyle);
  if (knownReply) {
    return knownReply;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || process.env.CHAT_TEST_MODE === '1') {
    return localizeFallback(reply, language, scriptStyle);
  }

  const languageName = language === 'sinhala' ? 'Sinhala' : 'Tamil';
  const scriptInstruction =
    language === 'sinhala'
      ? scriptStyle === 'roman'
        ? 'Use natural conversational Roman Sinhala written with Latin letters; do not use Sinhala characters.'
        : 'Use natural conversational Sinhala script, not romanized Sinhala.'
      : scriptStyle === 'roman'
        ? 'Use natural conversational Roman Tamil written with Latin letters; do not use Tamil characters.'
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

  return localizeFallback(reply, language, scriptStyle);
}

export async function generateConversationalReplyWithGemini(
  reply: string | null,
  language: CustomerLanguage,
  customerMessage: string,
  history: Array<{ role: string; message: string }>,
  brandName?: string | null,
  customerName?: string | null,
  scriptStyle: CustomerScriptStyle = 'native'
): Promise<string | null> {
  if (!reply) {
    return null;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || process.env.CHAT_TEST_MODE === '1') {
    return null;
  }

  const brandDisplayName = brandName || 'our store';
  const languageName =
    language === 'sinhala' ? 'Sinhala' : language === 'tamil' ? 'Tamil' : 'English';

  const scriptInstruction =
    language === 'sinhala'
      ? scriptStyle === 'roman'
        ? 'Reply in natural conversational Roman Sinhala using Latin letters, matching the customer. Do not use Sinhala characters.'
        : 'Reply in natural conversational Sinhala script (not romanized Sinhala).'
      : language === 'tamil'
        ? scriptStyle === 'roman'
          ? 'Reply in natural conversational Roman Tamil using Latin letters, matching the customer. Do not use Tamil characters.'
          : 'Reply in natural conversational Tamil script.'
        : 'Reply in English.';
  const historyText = formatConversationHistoryForPrompt(history);

  const prompt = `You are Nisha, a professional customer service representative for the online clothing store "${brandDisplayName}" in Sri Lanka.
Your task is to rewrite and translate the raw draft reply (DATABASE_VERIFIED_REPLY) into a warm, polite, and natural conversational response in ${languageName}, mirroring the customer's script style.

CONVERSATION CONTEXT:
- Customer's Name: ${customerName || 'Customer'}
- Latest message from Customer: "${customerMessage}"
- Recent conversation:
${historyText}

DATABASE_VERIFIED_REPLY (Your absolute source of truth):
"""
${reply}
"""

CRITICAL RULES FOR REWRITING:
1. STRICT CONTENT LIMITATION:
   - You must ONLY convey the information and options that are present in the DATABASE_VERIFIED_REPLY.
   - Do NOT add, invent, or assume any details (such as other product names, sizes, colors, prices, order IDs, or delivery times) that are not explicitly written in the DATABASE_VERIFIED_REPLY.
   - If the DATABASE_VERIFIED_REPLY asks for missing contact details, ONLY ask for those specific details. Do not ask for size or color unless the DATABASE_VERIFIED_REPLY asks for it.
   - If the customer's latest message contradicts the DATABASE_VERIFIED_REPLY, strictly ignore the contradiction and follow the DATABASE_VERIFIED_REPLY.
   - Do NOT create placeholders such as "[Insert Size Chart Here]" or mention attachments/media unless DATABASE_VERIFIED_REPLY explicitly says so.

2. PRESERVE STRUCTURED BLOCKS:
   - If the DATABASE_VERIFIED_REPLY contains an Order Summary block or a Contact Details block (where details are shown line-by-line using exact labels like Name:, Street Address:, City/Town:, District:, Phone Number:, Product:, Quantity:, Size:, Color:, Price:), you MUST preserve that exact line-by-line block format and values.
   - Do not wrap these summary blocks in markdown quotes, bullet points, or tables. Keep them as clean, plain-text blocks.
   - Make only the surrounding messages (intro/outro) conversational.

3. TONE & STYLE:
   - Write like an experienced human customer-service professional: friendly, polite, warm, calm, and premium.
   - Continue the existing conversation naturally. Do not greet again when the conversation is already in progress.
   - Use the recent conversation only to understand continuity, tone, and what has already been discussed. DATABASE_VERIFIED_REPLY remains the only source of business facts.
   - Answer the customer's latest intent directly. Do not repeat a question or explanation from the recent conversation unless DATABASE_VERIFIED_REPLY explicitly requires it.
   - Avoid canned or robotic openings such as "Certainly!", "How can I assist you today?", or repeatedly naming the store.
   - Do not copy the same opening or closing used in the immediately previous assistant reply when a natural alternative is possible.
   - Use the customer's name sparingly—at most once, only when a real name is known and it feels natural.
   - Do not claim to be human, and do not announce that you are an AI or virtual assistant. Simply speak in the store's customer-service voice.
   - Do not force a follow-up question when DATABASE_VERIFIED_REPLY already fully resolves the request.
   - Mirror the language and style of the customer, replying in ${scriptInstruction}
   - Product names, brand names, order IDs, prices, sizes, and colors must remain in their original form (e.g. "Rs 1650").
   - Keep the response concise (1-3 sentences maximum for the conversational parts).

Output only the final rewritten reply.`;

  const ai = new GoogleGenAI({ apiKey });

  for (let index = 0; index < TEXT_MODEL_CHAIN.length; index += 1) {
    const model = TEXT_MODEL_CHAIN[index];

    try {
      logDebug('Chat Language', `Trying Gemini text conversational model ${model}.`, {
        language,
      });
      const response = await ai.models.generateContent({
        model,
        contents: [{ text: prompt }],
        config: {
          temperature: 0.3,
        },
      });
      const rewritten = response.text?.trim();

      if (rewritten) {
        if (isUnsafeConversationalRewrite(rewritten)) {
          logWarn('Chat Language', 'Gemini conversational rewrite returned unsafe placeholder; using deterministic reply.', {
            language,
          });
          return null;
        }

        return rewritten;
      }
    } catch (error) {
      const status = getErrorStatus(error);

      if ((status === 429 || status === 503 || status === 404) && index < TEXT_MODEL_CHAIN.length - 1) {
        logWarn('Chat Language', `Gemini text conversational model ${model} failed; trying fallback.`, {
          language,
          status,
          nextModel: TEXT_MODEL_CHAIN[index + 1],
        });
        continue;
      }

      logError('Chat Language', 'Gemini text conversational rewriting failed.', error);
      break;
    }
  }

  return null;
}
