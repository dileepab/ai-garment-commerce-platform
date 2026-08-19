/**
 * Wordless messages.
 *
 * A customer who replies "👍🏽" was told "Sorry, I didn't quite catch that.
 * Could you share the item name, order ID, or the change you need? Or call or
 * WhatsApp our team on…" — a phone number pushed at someone who was only
 * saying thanks. normalizeText strips every emoji, so a thumbs-up reached the
 * intent matching as an empty string and fell through everything.
 *
 * Kept free of path aliases so it can be tested.
 */

/**
 * Emoji, skin-tone modifiers, the variation selector and the zero-width joiner
 * that holds a composed emoji together. Emoji_Component is deliberately not
 * used: it covers the ASCII digits and "#" that make up keycap sequences, so
 * "123" would count as an emoji.
 */
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍\s]+$/u;

const HAS_PICTOGRAPH = /\p{Extended_Pictographic}/u;

export function isEmojiOnlyMessage(message: string): boolean {
  const text = (message || '').trim();
  if (!text) return false;

  // A message has to contain a real pictograph, not merely be free of letters.
  if (!HAS_PICTOGRAPH.test(text)) return false;

  return EMOJI_ONLY.test(text);
}

/**
 * What to send back to a bare emoji.
 *
 * Matching their register: an operator answering this by hand sent "👍", and
 * that is the right length of reply to a message with no question in it.
 */
export function buildEmojiAcknowledgementReply(): string {
  return '👍';
}
