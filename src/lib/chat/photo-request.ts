/**
 * Whether the customer actually asked to see the item.
 *
 * Every product question used to come back with four photographs attached. Ask
 * "What is the fabric of the skort?" and you got two images and one line of
 * text; ask "Price" and you got the same two images again. On WhatsApp that is
 * four downloads to read six words, and it buries the answer.
 *
 * Photographs are now sent when they are what was asked for, and not otherwise.
 *
 * Kept free of path aliases so it can be tested.
 */

const PHOTO_WORDS =
  /\b(?:photos?|pics?|pictures?|images?|snaps?)\b/i;

/**
 * "Show me", "send it", "can I see" — a request to look at the thing, phrased
 * without ever saying "photo".
 */
const SHOW_PHRASES =
  /\b(?:show|see|send|share)\b[^.?!]{0,24}\b(?:it|this|that|them|one|item|product|dress|top|skirt|skort|shorts?|pants?|trousers?|saree|gown)\b/i;

const LOOKS_LIKE =
  /\b(?:how(?:'s| is| does)?\s+(?:it|this|that)\s+look|what\s+does\s+it\s+look\s+like|looks?\s+like)\b/i;

/**
 * Romanised Sinhala and Tamil that show up in this inbox. "ewanna" is "send",
 * "pennanna" is "show", "anuppunga" is "send".
 */
const LOCAL_PHRASES =
  /\b(?:ewanna|ewannako|evanna|pennanna|penvanna|anuppunga|anuppu)\b/i;

/** A size chart is its own reply; asking for one is not asking for the item. */
const SIZE_CHART = /\bsize\s*chart\b/i;

export function looksLikePhotoRequest(message: string): boolean {
  const text = (message || '').trim();
  if (!text) return false;

  // "Send me the size chart" is handled by the size chart reply and must not
  // drag the product photographs along with it.
  if (SIZE_CHART.test(text) && !PHOTO_WORDS.test(text)) return false;

  return (
    PHOTO_WORDS.test(text) ||
    SHOW_PHRASES.test(text) ||
    LOOKS_LIKE.test(text) ||
    LOCAL_PHRASES.test(text)
  );
}
