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
  /** Every item code in the post, for a post covering more than one product. */
  itemCodes?: Array<string | null | undefined> | null;
  productName?: string | null;
}

// Past a handful the list stops describing the post and just makes the URL
// long, so bigger posts fall back to the generic opener.
const MAX_PREFILL_CODES = 4;

function buildPrefillMessage(codes: string[]): string {
  if (codes.length === 1) return `Order ${codes[0]}`;

  // "Order HAP-0001 HAP-0002" reads as ordering both, and the bot builds
  // multi-item orders now — a shopper still deciding would land in a two-dress
  // draft. "Details" asks about them instead while still naming exactly what
  // they were looking at, which is the part "I saw your post" threw away.
  if (codes.length > 1 && codes.length <= MAX_PREFILL_CODES) {
    return `Details ${codes.join(' ')}`;
  }

  return 'I saw your post';
}

/**
 * Splits a trailing run of hashtags off the end of a caption.
 *
 * Facebook truncates a long caption behind "See more", and the generated copy
 * ends in a block of hashtags — so an order link appended after them starts out
 * hidden. The hashtags sit at the end of the last line rather than on their own,
 * so this splits within the text rather than by line.
 */
function splitTrailingHashtags(caption: string): { body: string; hashtags: string } {
  const trimmed = caption.trimEnd();
  const match = trimmed.match(/(?:\s*#[^\s#]+)+\s*$/);

  // index 0 would mean the caption is nothing but hashtags; leave that alone.
  if (!match || !match.index) {
    return { body: trimmed, hashtags: '' };
  }

  return { body: trimmed.slice(0, match.index).trimEnd(), hashtags: match[0].trim() };
}

export function buildWhatsAppOrderLink(options: WhatsAppOrderLinkOptions): string | null {
  const number = normalizeWhatsAppNumber(options.displayPhoneNumber);
  if (!number) return null;

  const codes = Array.from(
    new Set(
      [options.itemCode, ...(options.itemCodes ?? [])]
        .map((code) => code?.trim())
        .filter((code): code is string => Boolean(code))
    )
  );

  // The prefill is spent twice over: it is what the customer sends, and it is
  // also visible in the caption as percent-encoded noise, where every space
  // costs three characters. The item code alone identifies the product — the
  // name added length to the URL without telling the bot anything the code did
  // not already say.
  //
  // It deliberately does not open with "Hi". A message starting with a greeting
  // is treated as a bare greeting unless something else in it carries intent,
  // and answering a click-to-order link with "Hello, how can I help?" wastes
  // the one thing the customer told us.
  const message = buildPrefillMessage(codes);

  return `${WA_ME_BASE}${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Adds the order line to a caption, unless the caption already links to
 * WhatsApp — regenerating a caption should not stack duplicate links.
 *
 * The line goes above any trailing hashtags rather than at the very end, so it
 * stays visible when Facebook collapses the caption behind "See more".
 */
export function appendWhatsAppOrderLine(
  caption: string,
  options: WhatsAppOrderLinkOptions
): string {
  const link = buildWhatsAppOrderLink(options);
  if (!link) return caption;
  if (/wa\.me\//i.test(caption)) return caption;

  const { body, hashtags } = splitTrailingHashtags(caption);
  const orderLine = `Order on WhatsApp: ${link}`;

  return hashtags ? `${body}\n\n${orderLine}\n\n${hashtags}` : `${body}\n\n${orderLine}`;
}
