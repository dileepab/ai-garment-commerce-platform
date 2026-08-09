/**
 * Telling "add this as well" apart from "change it to this".
 *
 * Both arrive as the same routed action with a product, a size or a colour, so
 * without this the second dress silently replaced the first and the customer
 * was quoted one item they never asked to swap to. The two readings are not
 * symmetrical in cost: a wrong "add" shows up on the summary the customer is
 * asked to confirm, while a wrong "replace" throws away something they said.
 *
 * Only wording that clearly means "as well as" counts. A correction marker
 * ("actually", "instead", "no, make it") wins outright — customers routinely
 * write "no, make it L and also send it Friday", and that is a change.
 */

const ADDITION_PATTERNS: RegExp[] = [
  // English
  /\balso\b/i,
  /\badd\b/i,
  /\bas well\b/i,
  /\b(?:one|1) more\b/i,
  /\banother\b/i,
  /\bextra\b/i,
  /\btoo\b/i,
  /\bplus\b/i,
  /\balong with\b/i,
  /\btogether with\b/i,
  // Sinhala: තව / තවත් (more), එකත් (that one too), සමඟ (with)
  /තවත්?/,
  /එකත්/,
  /සමඟ/,
  /\b(?:thawa|tawa|thawath|tawath)\b/i,
  /\b(?:ekath|ekt)\b/i,
  // Tamil: இன்னும் (more), கூட (also), சேர் (add)
  /இன்னும்/,
  /கூட/,
  /சேர்/,
  /\b(?:innum|innoru)\b/i,
  /\bkooda\b/i,
];

const CORRECTION_PATTERNS: RegExp[] = [
  /\bactually\b/i,
  /\binstead\b/i,
  /\bchange (?:it|that|the)\b/i,
  /\bmake it\b/i,
  /\brather\b/i,
  /\bnot\b\s+(?:the|that)\b/i,
  /\bcancel\b/i,
  /\bනැහැ\b/,
  /\bවෙනුවට\b/,
  /\bwenuwata\b/i,
  /\bpaharaka\b/i,
  /\bவேண்டாம்\b/,
  /\bbadhilaaka\b/i,
];

/**
 * True when the message asks for something to be added to what is already in
 * the order, rather than swapped for it.
 */
export function looksLikeItemAdditionRequest(message: string): boolean {
  const text = message?.trim();
  if (!text) return false;

  if (CORRECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }

  return ADDITION_PATTERNS.some((pattern) => pattern.test(text));
}
