/**
 * Keeps the photo a customer sent.
 *
 * A shopper photographs a dress and asks what it is. The image was fetched,
 * handed to Gemini so it could answer, and then dropped — nothing stored,
 * nothing rendered. The agent opening that conversation in the support inbox saw
 * "What is this item?" and no item.
 *
 * The two sources need different handling and neither survives on its own.
 * WhatsApp media has to be fetched with the access token, so it arrives as a
 * data URL that is far too large to sit in a database row. Messenger and
 * Instagram give a Meta CDN link that stops resolving after a while. Both are
 * re-hosted on blob storage, which is where product and creative images already
 * live, so the thread still shows the photo months later.
 *
 * The pure parts are kept free of prisma, blob and path aliases so they can be
 * tested without a network.
 */

export interface ParsedImageDataUrl {
  mimeType: string;
  base64: string;
}

/** `data:image/jpeg;base64,/9j/4AAQ...` → its parts, or null if it is not one. */
export function parseImageDataUrl(value: string | null | undefined): ParsedImageDataUrl | null {
  if (!value) return null;

  // [\s\S] rather than the dotAll flag, which needs a newer target than this
  // project compiles to. Base64 payloads can be wrapped across lines.
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;

  const mimeType = match[1].trim().toLowerCase();
  const base64 = match[2].trim();

  if (!mimeType.startsWith('image/') || !base64) return null;

  return { mimeType, base64 };
}

/**
 * Extension for the stored object. Blob keys are opaque, but a wrong extension
 * makes the file awkward to open when someone downloads it to check a claim.
 */
export function inboundImageExtension(mimeType: string | null | undefined): string {
  const subtype = (mimeType || '').toLowerCase().split('/')[1]?.split(';')[0]?.trim();

  if (!subtype) return 'jpg';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';

  // Anything unexpected is stored as-is rather than guessed at, but only when it
  // looks like a file extension — never a path fragment.
  return /^[a-z0-9]{1,5}$/.test(subtype) ? subtype : 'jpg';
}

/**
 * Namespaced by channel so a conversation's photos are easy to find, and
 * suffixed randomly because two customers can send a photo in the same
 * millisecond.
 */
export function buildInboundImageKey(params: {
  channel: string;
  mimeType?: string | null;
  now?: number;
  random?: string;
}): string {
  const channel = (params.channel || 'chat').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'chat';
  const stamp = params.now ?? Date.now();
  const suffix = params.random ?? Math.random().toString(36).slice(2, 8);

  return `chat/${channel}/${stamp}-${suffix}.${inboundImageExtension(params.mimeType)}`;
}

/** An http(s) link we can re-fetch, as opposed to an inline data URL. */
export function isFetchableImageUrl(value: string | null | undefined): boolean {
  return Boolean(value && /^https?:\/\//i.test(value.trim()));
}
