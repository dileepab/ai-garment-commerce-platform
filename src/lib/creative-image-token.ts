import { createHmac, timingSafeEqual } from 'node:crypto';

// Meta downloads creative images from a public URL while publishing, so the
// image route cannot simply require a session. Instead, publish mints a
// short-lived signed link for the one creative it is publishing; every other
// caller has to be an authenticated user.

// Meta fetches during the publish call, but Instagram carousels are created and
// polled over several requests. A week is far longer than any publish takes and
// still bounds how long a leaked link stays usable.
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

// The catalog feed and chat replies hand Meta a URL it may fetch well after the
// link was generated, so those callers need a longer window than publishing.
export const CATALOG_TTL_SECONDS = 30 * 24 * 60 * 60;

function getSigningSecret(): string | null {
  const secret = process.env.CREATIVE_IMAGE_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  return secret || null;
}

function computeSignature(secret: string, creativeId: number, expiresAt: number): Buffer {
  return createHmac('sha256', secret)
    .update(`creative-image:${creativeId}:${expiresAt}`)
    .digest();
}

export interface SignedImageParams {
  exp: string;
  token: string;
}

// Returns null when no secret is configured — callers fall back to an unsigned
// URL so publishing keeps working rather than failing closed on a misconfig.
export function signCreativeImageUrl(
  creativeId: number,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): SignedImageParams | null {
  const secret = getSigningSecret();
  if (!secret) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return {
    exp: String(expiresAt),
    token: computeSignature(secret, creativeId, expiresAt).toString('hex'),
  };
}

// Builds the app-relative image path with a signed query string attached.
// Falls back to the bare path when no secret is configured.
export function creativeImagePath(creativeId: number, ttlSeconds?: number): string {
  const signed = signCreativeImageUrl(creativeId, ttlSeconds);
  const query = signed ? `?exp=${signed.exp}&token=${signed.token}` : '';
  return `/api/content/creatives/${creativeId}/image${query}`;
}

export function verifyCreativeImageToken(
  creativeId: number,
  exp: string | null,
  token: string | null,
): boolean {
  const secret = getSigningSecret();
  if (!secret || !exp || !token) return false;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = computeSignature(secret, creativeId, expiresAt);
  let received: Buffer;
  try {
    received = Buffer.from(token, 'hex');
  } catch {
    return false;
  }

  return expected.length === received.length && timingSafeEqual(expected, received);
}
