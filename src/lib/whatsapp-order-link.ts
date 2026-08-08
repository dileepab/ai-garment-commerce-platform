/**
 * Click-to-WhatsApp links for post captions.
 *
 * Organic Facebook and Instagram posts cannot carry a call-to-action button —
 * that is an ads-only feature — so the link has to live in the caption text.
 *
 * The message is prefilled with the item code where the post is about one
 * product. That is the whole point: the customer's first message already
 * identifies what they want, so the bot answers about the dress instead of
 * asking which one, and the code survives being retyped (see product-item-code).
 */
const WA_ME_BASE = 'https://wa.me/';

/** Digits only — wa.me rejects +, spaces and dashes. */
export function normalizeWhatsAppNumber(value?: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  // Sri Lankan numbers in international form are 11 digits (94 + 9); allow the
  // usual range rather than pinning to one country.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export interface WhatsAppOrderLinkOptions {
  displayPhoneNumber?: string | null;
  /** Item code of the product the post is about, when it is about just one. */
  itemCode?: string | null;
  productName?: string | null;
}

export function buildWhatsAppOrderLink(options: WhatsAppOrderLinkOptions): string | null {
  const number = normalizeWhatsAppNumber(options.displayPhoneNumber);
  if (!number) return null;

  const itemCode = options.itemCode?.trim();
  const productName = options.productName?.trim();

  // Without a single product there is nothing useful to prefill, so send them
  // through with a plain opener rather than a misleading one.
  const message = itemCode
    ? `Hi, I'm interested in ${itemCode}${productName ? ` (${productName})` : ''}`
    : 'Hi, I saw your post and I am interested';

  return `${WA_ME_BASE}${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Appends the order line to a caption, unless the caption already links to
 * WhatsApp — regenerating a caption should not stack duplicate links.
 */
export function appendWhatsAppOrderLine(
  caption: string,
  options: WhatsAppOrderLinkOptions
): string {
  const link = buildWhatsAppOrderLink(options);
  if (!link) return caption;
  if (/wa\.me\//i.test(caption)) return caption;

  const trimmed = caption.trimEnd();
  return `${trimmed}\n\nOrder on WhatsApp: ${link}`;
}
