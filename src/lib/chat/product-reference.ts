/**
 * Decides whether "this dress" means the dress already on the table.
 *
 * From the conversation this exists for: the bot named an item and quoted its
 * fabric, and one message later the customer asked "මේ ගවුම මැටීරියල් මොනවාද" —
 * what is this dress's material. The bot asked her which item she meant. The
 * answer was in its own previous message.
 *
 * The cause is that Gemini extracted a product name of roughly "this dress".
 * That matches nothing in the catalog, and the conversation memory was only
 * consulted when no name had been extracted at all — so a wrong guess erased
 * the context that an empty guess would have kept.
 *
 * Falling back on *any* unmatched name would be worse than the bug. "Do you
 * have kurtas?" would be answered with details of the last dress discussed,
 * confidently and wrongly. So the fallback is limited to words that identify
 * nothing on their own: demonstratives and bare garment nouns. A name carrying
 * real information is left to fail, because asking is better than guessing.
 *
 * Kept free of prisma and path aliases so the behaviour can be tested.
 */

/**
 * Words that cannot single out a product: pronouns, articles, and the generic
 * nouns for "garment" in the three languages customers write in. Sinhala and
 * Singlish are both listed because the same customer switches between them
 * mid-conversation.
 */
const REFERENTIAL_WORDS = new Set([
  // English
  'this', 'that', 'these', 'those', 'the', 'it', 'its', 'one', 'ones',
  'item', 'items', 'product', 'dress', 'dresses', 'gown', 'gowns', 'frock',
  'frocks', 'outfit', 'garment', 'piece',
  // Sinhala
  'මේ', 'ඒ', 'මෙම', 'මෙය', 'ගවුම', 'ගවුමේ', 'ගවුම්', 'ඇඳුම', 'ඇඳුමේ', 'ඇඳුම්',
  'අඳුම', 'අඳුමේ', 'භාණ්ඩය', 'භාණ්ඩයේ',
  // Singlish. "me"/"ara"/"oya" are the demonstratives that precede the noun —
  // "me gawma" is "this dress" — not the English pronoun.
  'me', 'ara', 'oya', 'oye', 'meka', 'meke', 'mema', 'mekata', 'eka', 'eke',
  'ekata', 'gawma', 'gawme', 'gaum', 'gauma', 'gaume', 'aduma', 'adume', 'adum',
  'ekak',
  // Tamil
  'இது', 'அது', 'உடை', 'ஆடை',
]);

/**
 * True when every word in the extracted name is one of the above — "this
 * dress" and "ගවුම" qualify, "kurta" and "this kurta" do not.
 *
 * Requiring *every* word to be referential is what keeps this safe: one
 * informative word is enough to mean the customer is naming something else,
 * and then falling back to the previous product would answer the wrong
 * question.
 */
export function isReferentialProductMention(
  productName: string | null | undefined
): boolean {
  if (!productName) return false;

  const words = productName
    .trim()
    .toLowerCase()
    // Punctuation only; the Unicode letters must survive.
    .replace(/[.,!?"'()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return false;

  return words.every((word) => REFERENTIAL_WORDS.has(word));
}

/**
 * Whether the conversation's remembered product may stand in for the name the
 * customer used.
 *
 * `matchedProduct` is whatever `findProductByName` returned. When it found
 * something, that wins and this is irrelevant. When nothing was extracted at
 * all, context has always been used and still is.
 */
export function canFallBackToConversationProduct(params: {
  extractedProductName: string | null | undefined;
  matchedProduct: unknown;
}): boolean {
  if (params.matchedProduct) return false;

  const extracted = params.extractedProductName?.trim();
  if (!extracted) return true;

  return isReferentialProductMention(extracted);
}
