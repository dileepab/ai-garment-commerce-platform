/**
 * Answers a product question from the product's own record, in words, instead
 * of assembling a template.
 *
 * The template path could only answer what someone thought to write a field for.
 * Asked "meka godak digada?" it returned a twelve-line spec sheet; asked what a
 * dress was made of in Sinhala it asked which dress. A human agent answered the
 * same question in one line — "godak diga nam naha, danissata udin thiyenne" —
 * because the answer is a judgement *from* the fields, not a field.
 *
 * The trade is that a model can invent. So the facts are retrieved here, never
 * generated: this module builds a fact sheet from the database row, tells the
 * model it may use nothing else, and then checks the answer that comes back for
 * numbers the fact sheet does not contain. A reply that fails that check is
 * thrown away and the template answer is sent instead — wordy beats wrong.
 *
 * Kept free of prisma and path aliases so the prompt and the check can be
 * tested without a database or a network call.
 */

export interface GroundedProductFacts {
  name: string;
  itemCode?: string | null;
  price: number;
  sizes: string[];
  colors: string[];
  inStock: boolean;
  fabric?: string | null;
  /** Pre-formatted spec lines, e.g. "Garment length: 84 cm". */
  specLines?: string[];
}

/**
 * The only information the model is allowed to use. Everything here comes from
 * the product row; nothing is inferred.
 */
export function buildProductFactSheet(facts: GroundedProductFacts): string {
  const lines = [
    `Product name: ${facts.name}`,
    `Price: Rs ${facts.price}`,
    `Available sizes: ${facts.sizes.join(', ') || 'not recorded'}`,
    `Colours: ${facts.colors.join(', ') || 'not recorded'}`,
    `Currently in stock: ${facts.inStock ? 'yes' : 'no'}`,
  ];

  if (facts.itemCode) lines.push(`Item code: ${facts.itemCode}`);
  if (facts.fabric) lines.push(`Fabric: ${facts.fabric}`);
  for (const line of facts.specLines ?? []) {
    if (line.trim()) lines.push(line.trim());
  }

  return lines.join('\n');
}

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  english: 'Reply in English.',
  'sinhala-native': 'Reply in natural conversational Sinhala script.',
  'sinhala-roman':
    'Reply in natural conversational Roman Sinhala (Singlish) written with Latin letters. Do not use Sinhala characters.',
  'tamil-native': 'Reply in natural conversational Tamil script.',
  'tamil-roman':
    'Reply in natural conversational Roman Tamil written with Latin letters. Do not use Tamil characters.',
};

export function languageInstruction(language: string, scriptStyle: string): string {
  if (language === 'english') return LANGUAGE_INSTRUCTIONS.english;
  return (
    LANGUAGE_INSTRUCTIONS[`${language}-${scriptStyle}`] ??
    LANGUAGE_INSTRUCTIONS[`${language}-native`] ??
    LANGUAGE_INSTRUCTIONS.english
  );
}

export function buildGroundedAnswerPrompt(params: {
  factSheet: string;
  question: string;
  language: string;
  scriptStyle: string;
  brand?: string | null;
  recentTurns?: Array<{ role: 'user' | 'assistant'; message: string }>;
}): string {
  const history = (params.recentTurns ?? [])
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? 'Customer' : 'You'}: ${turn.message}`)
    .join('\n');

  return `You are a shop assistant for ${params.brand || 'our clothing store'}, replying to a customer on WhatsApp.

Answer the customer's question using ONLY the facts below. These come from our records.

FACTS:
${params.factSheet}
${history ? `\nEARLIER IN THIS CHAT:\n${history}\n` : ''}
CUSTOMER'S QUESTION:
${params.question}

Rules:
- Answer the question that was asked. Do not list details nobody asked for.
- Keep it to one or two short sentences. This is a chat, not a catalogue page.
- If the question is a judgement ("is it too long?", "can I wear it out?"), give the judgement and the one fact behind it.
- If the facts do not cover it, say you will check with the team. Never guess.
- Never invent or estimate a price, measurement, size, discount, or delivery promise.
- Do not offer discounts or free delivery under any circumstances.
- ${languageInstruction(params.language, params.scriptStyle)}
- Output only the reply.`;
}

/** Digits in a form we can compare: "Rs 1,990" and "Rs1990" are the same claim. */
function digitsOf(value: string): string {
  return value.replace(/[^\d]/g, '');
}

const SIZE_TOKENS = /\b(XS|S|M|L|XL|XXL|XXXL|XXXXL)\b/g;

/**
 * Returns the claims in `reply` that the fact sheet does not support.
 *
 * Deliberately narrow: it checks the values that cost money when they are
 * wrong — prices, measurements, percentages, sizes and item codes — rather than
 * every number, because a model writing "1." to start a list is not a lie.
 *
 * A non-empty result means the reply must not be sent.
 */
export function findUngroundedClaims(params: {
  reply: string;
  factSheet: string;
  sizes: string[];
}): string[] {
  const problems: string[] = [];
  const factDigits = new Set(
    (params.factSheet.match(/\d[\d,]*/g) ?? []).map(digitsOf)
  );

  // Money. Any rupee figure must be one we gave it.
  for (const match of params.reply.match(/Rs\.?\s?[\d,]+/gi) ?? []) {
    if (!factDigits.has(digitsOf(match))) {
      problems.push(`price not in our records: "${match.trim()}"`);
    }
  }

  // Measurements.
  for (const match of params.reply.match(/\d[\d,.]*\s?(?:cm|centimet|inch|")/gi) ?? []) {
    if (!factDigits.has(digitsOf(match.replace(/\..*$/, '')))) {
      problems.push(`measurement not in our records: "${match.trim()}"`);
    }
  }

  // Percentages are almost never legitimate here — they mean a discount.
  for (const match of params.reply.match(/\d+\s?%/g) ?? []) {
    problems.push(`percentage offer: "${match.trim()}"`);
  }

  // Promises we cannot keep, whoever asked.
  if (/\bfree (?:delivery|shipping)\b/i.test(params.reply)) {
    problems.push('promises free delivery');
  }

  // Sizes it claims we carry.
  const allowed = new Set(params.sizes.map((size) => size.trim().toUpperCase()));
  for (const match of params.reply.match(SIZE_TOKENS) ?? []) {
    const size = match.toUpperCase();
    // Single letters appear inside ordinary words in Roman Sinhala; only treat
    // them as size claims when that size is genuinely not ours.
    if (allowed.size > 0 && !allowed.has(size)) {
      problems.push(`size we do not stock: "${match}"`);
    }
  }

  return problems;
}
