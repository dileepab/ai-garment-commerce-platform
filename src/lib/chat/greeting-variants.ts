/**
 * Greeting wording, varied across customers.
 *
 * Every customer used to receive one byte-identical sentence — "Hello. How can
 * I help you with Happybuy today?" — and a Page sending thousands of identical
 * automated messages is the pattern Meta's messaging-integrity systems act on.
 * The Happybuy Page was restricted from messaging for two weeks.
 *
 * Selection is seeded by the customer's name, so one person always sees the
 * same wording — varying it between their own messages would read as broken,
 * not friendly — while different people see different text.
 *
 * Each variant carries its Sinhala and Tamil forms. The localisation layer used
 * to recognise the single English greeting with a regex; adding English wording
 * without its translations would silently leave Sinhala and Tamil customers
 * reading English, so a variant is only complete when every language is filled
 * in.
 */

export interface GreetingVariant {
  en: (namePart: string, storeName: string) => string;
  sinhala: (namePart: string, storeName: string) => string;
  sinhalaRoman: (namePart: string, storeName: string) => string;
  tamil: (namePart: string, storeName: string) => string;
  tamilRoman: (namePart: string, storeName: string) => string;
  /** Recovers the name and store from a built English greeting. */
  match: RegExp;
}

export const GREETING_VARIANTS: GreetingVariant[] = [
  {
    en: (n, s) => `Hello${n}. How can I help you with ${s} today?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}. අද ${s} ගැන මට ඔබට කෙසේ උදව් කළ හැකිද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}. ${s} gena ada kohomada udaw karanna puluwanda?`,
    tamil: (n, s) => `வணக்கம்${n}. இன்று ${s} பற்றி நான் எப்படி உதவலாம்?`,
    tamilRoman: (n, s) => `Vanakkam${n}. Innaikku ${s} pathi eppadi help pannattum?`,
    match: /^Hello(?: ([^.]+))?\. How can I help you with (.+) today\?$/,
  },
  {
    en: (n, s) => `Hi${n}, welcome to ${s}. What can I help you find?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}, ${s} වෙත සාදරයෙන් පිළිගනිමු. ඔබට කුමක් සොයා ගැනීමට උදව් කරන්නද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}, ${s} ta piligannawa. Oyata mokakda hoyaganna udaw karanne?`,
    tamil: (n, s) => `வணக்கம்${n}, ${s} க்கு வரவேற்கிறோம். எதைத் தேட உதவட்டும்?`,
    tamilRoman: (n, s) => `Vanakkam${n}, ${s} ku varaverkirom. Edha thеda help pannattum?`,
    match: /^Hi(?:\s([^,]+))?, welcome to (.+)\. What can I help you find\?$/,
  },
  {
    en: (n, s) => `Hello${n}, thanks for messaging ${s}. What are you looking for?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}, ${s} වෙත පණිවිඩය එවීම ගැන ස්තූතියි. ඔබ සොයන්නේ කුමක්ද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}, ${s} ta message eka evapu eka gana sthuthi. Oya hoyanne mokakda?`,
    tamil: (n, s) => `வணக்கம்${n}, ${s} க்கு தகவல் அனுப்பியதற்கு நன்றி. நீங்கள் எதைத் தேடுகிறீர்கள்?`,
    tamilRoman: (n, s) => `Vanakkam${n}, ${s} ku message anuppinadhukku nandri. Neenga edha thеdureenga?`,
    match: /^Hello(?:\s([^,]+))?, thanks for messaging (.+)\. What are you looking for\?$/,
  },
  {
    en: (n, s) => `Hi${n}. ${s} here — how can I help?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}. මෙය ${s} — මට ඔබට කෙසේ උදව් කළ හැකිද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}. Meka ${s} — mata oyata kohomada udaw karanna puluwan?`,
    tamil: (n, s) => `வணக்கம்${n}. இது ${s} — நான் எப்படி உதவலாம்?`,
    tamilRoman: (n, s) => `Vanakkam${n}. Idhu ${s} — naan eppadi help pannattum?`,
    match: /^Hi(?:\s([^.]+))?\. (.+) here — how can I help\?$/,
  },
];

/** Small stable hash, so the same customer keeps the same wording. */
function seedIndex(seed: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % length;
}

export function pickGreetingVariant(seed: string): GreetingVariant {
  if (!seed) {
    // Nothing stable to key on, so spread these across variants rather than
    // sending every anonymous customer the same sentence.
    return GREETING_VARIANTS[Math.floor(Math.random() * GREETING_VARIANTS.length)];
  }

  return GREETING_VARIANTS[seedIndex(seed, GREETING_VARIANTS.length)];
}

/**
 * The first thing a customer hears, on first contact.
 *
 * These say who they are talking to. A shopper who knows it is an AI forgives
 * a wrong turn and asks again; one who thought it was staff feels misled when
 * it slips, and that is the message that turns into a complaint.
 *
 * They are varied for the same reason the plain greetings are: one fixed
 * sentence sent to every new customer is the pattern that had the Happybuy
 * Page restricted from messaging for two weeks.
 *
 * "AI assistant" rather than "assistant" — on its own the word reads as a
 * member of staff, which is the impression this exists to avoid.
 */
export const INTRO_VARIANTS: GreetingVariant[] = [
  {
    en: (n, s) => `Hi${n}, you are chatting with ${s}'s AI assistant. What can I help you find?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}, ඔබ කතා කරන්නේ ${s} හි AI සහායක සමඟයි. ඔබට කුමක් සොයා ගැනීමට උදව් කරන්නද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}, oya katha karanne ${s} ge AI assistant ekka. Oyata mokakda hoyaganna udaw karanne?`,
    tamil: (n, s) => `வணக்கம்${n}, நீங்கள் ${s} இன் AI உதவியாளருடன் பேசுகிறீர்கள். எதைத் தேட உதவட்டும்?`,
    tamilRoman: (n, s) => `Vanakkam${n}, neenga ${s} oda AI assistant kooda pesureenga. Edha theda help pannattum?`,
    match: /^Hi(?:\s([^,]+))?, you are chatting with (.+)'s AI assistant\. What can I help you find\?$/,
  },
  {
    en: (n, s) => `Hello${n}. ${s}'s AI assistant here — how can I help?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}. ${s} හි AI සහායක මෙතැන — කෙසේ උදව් කරන්නද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}. ${s} ge AI assistant methana — kohomada udaw karanne?`,
    tamil: (n, s) => `வணக்கம்${n}. ${s} இன் AI உதவியாளர் இங்கே — எப்படி உதவலாம்?`,
    tamilRoman: (n, s) => `Vanakkam${n}. ${s} oda AI assistant inga — eppadi help pannattum?`,
    match: /^Hello(?:\s([^.]+))?\. (.+)'s AI assistant here — how can I help\?$/,
  },
  {
    en: (n, s) => `Hi${n}, thanks for messaging ${s}. I am the AI assistant here; what are you looking for?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}, ${s} වෙත පණිවිඩය එවීම ගැන ස්තුතියි. මම මෙහි AI සහායකයා; ඔබ සොයන්නේ කුමක්ද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}, ${s} ta message kaleta stuthi. Mama methana AI assistant; oya hoyanne mokakda?`,
    tamil: (n, s) => `வணக்கம்${n}, ${s} க்கு செய்தி அனுப்பியதற்கு நன்றி. நான் இங்கே AI உதவியாளர்; எதைத் தேடுகிறீர்கள்?`,
    tamilRoman: (n, s) => `Vanakkam${n}, ${s} ku message pannadhukku nandri. Naan inga AI assistant; edha thedureenga?`,
    match: /^Hi(?:\s([^,]+))?, thanks for messaging (.+)\. I am the AI assistant here; what are you looking for\?$/,
  },
  {
    en: (n, s) => `Hello${n}, this is ${s}'s AI assistant. What can I help you with today?`,
    sinhala: (n, s) => `ආයුබෝවන්${n}, මෙය ${s} හි AI සහායකයා. අද ඔබට කෙසේ උදව් කරන්නද?`,
    sinhalaRoman: (n, s) => `Ayubowan${n}, meka ${s} ge AI assistant. Ada oyata kohomada udaw karanne?`,
    tamil: (n, s) => `வணக்கம்${n}, இது ${s} இன் AI உதவியாளர். இன்று எப்படி உதவலாம்?`,
    tamilRoman: (n, s) => `Vanakkam${n}, idhu ${s} oda AI assistant. Innaikku eppadi help pannattum?`,
    match: /^Hello(?:\s([^,]+))?, this is (.+)'s AI assistant\. What can I help you with today\?$/,
  },
];

export function pickIntroVariant(seed: string): GreetingVariant {
  if (!seed) {
    return INTRO_VARIANTS[Math.floor(Math.random() * INTRO_VARIANTS.length)];
  }

  return INTRO_VARIANTS[seedIndex(seed, INTRO_VARIANTS.length)];
}

export interface LocalizedGreeting {
  namePart: string;
  storeName: string;
  variant: GreetingVariant;
}

/** Recognises any built greeting so the localisation layer can translate it. */
export function matchGreeting(reply: string): LocalizedGreeting | null {
  // Introductions first: both sets are anchored, so they cannot overlap, but
  // leaving them out here was how a Sinhala customer would have read one in
  // English.
  for (const variant of [...INTRO_VARIANTS, ...GREETING_VARIANTS]) {
    const found = reply.match(variant.match);
    if (found) {
      const [, customerName, storeName] = found;
      return {
        namePart: customerName ? ` ${customerName}` : '',
        storeName,
        variant,
      };
    }
  }

  return null;
}
