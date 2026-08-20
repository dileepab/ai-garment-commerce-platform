/**
 * "I'll take it", in the languages customers actually write.
 *
 * The order gate matched i want / i need / i would like / order / buy / get,
 * and nothing else. A customer who had just been shown a skort replied
 * "හා සතුටුයි මට" — yes, I'm happy with it — and was told the bot did not
 * understand and had passed the conversation to the team. That is a buyer
 * being dropped at the moment of buying, and it is the warmest message in the
 * whole inbox.
 *
 * Only consulted once a product is already on the table, so these words are
 * read in the one context where they can only mean the sale. On its own "ඕන"
 * is just "want".
 *
 * Kept free of path aliases so it can be tested.
 */

/** Wanting, taking, buying — native script. */
const WANTS_NATIVE =
  /ඕන|ඕනේ|ඕනි|ගන්නවා|ගන්නව|ගන්නම්|මිලදී|ඕඩර්|வேண்டும்|வாங்க|வாங்குறேன்|ஆர்டர்/;

/** The same, romanised, which is how most of this inbox types. */
const WANTS_ROMAN =
  /\b(?:ona|onee|oney|onne|gannawa|gannava|gannam|ganna|milade|oder|venum|vendum|vanga|vangren)\b/i;

/**
 * Agreement. Meaningless alone, decisive right after a price — which is the
 * only place this is asked.
 */
const AGREES_NATIVE = /හා|ඔව්|හරි|සතුටුයි|හොඳයි|ஆம்|சரி|நல்லது/;

const AGREES_ROMAN =
  /\b(?:ow|owu|ama|aama|hari|hariyi|hondai|honda|sathutui|sari|seri|aan|aama)\b/i;

/**
 * Sinhala marks a question with ද, and it attaches to the very words above.
 * "ගන්නවද" is "do you charge", not "I will take it" — the delivery charge
 * question "ඩිලිවරි කරන්න කීයක් ගන්නවද?" is the one that exposed this, the
 * same word doing both jobs that කීයක් does for how many and how much.
 */
const NATIVE_QUESTION_FORM = /ගන්නවද|ගන්නද|ඕනද|ඕනෙද|ගන්නවාද/;

export function looksLikePurchaseIntent(message: string): boolean {
  const text = (message || '').trim();
  if (!text) return false;

  if (NATIVE_QUESTION_FORM.test(text)) return false;

  return (
    WANTS_NATIVE.test(text) ||
    WANTS_ROMAN.test(text) ||
    AGREES_NATIVE.test(text) ||
    AGREES_ROMAN.test(text)
  );
}
