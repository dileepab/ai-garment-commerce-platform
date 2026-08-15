/**
 * Locating and validating the persona photograph.
 *
 * Two failures, one after the other, both silent.
 *
 * First the image was read from `public/` on the local filesystem, which does
 * not exist in a Vercel serverless function. Then it was fetched over HTTP —
 * from a path that sits behind NextAuth. A server-side fetch carries no session
 * cookie, so the middleware redirected to /login and returned 11KB of HTML with
 * status 200. `res.ok` was true, the content-type check fell back to the file
 * extension, and a login page was base64-encoded and handed to Gemini labelled
 * as a PNG.
 *
 * That is worse than sending nothing: the prompt then claims an Image A exists
 * and instructs the model to copy a face from an HTML document. The model falls
 * back to the persona's written description, which is why the same batch
 * produced a Sri Lankan model on one angle and a European one on the other.
 *
 * The rule now: anything that is not demonstrably an image is not an image.
 *
 * Kept free of path aliases so it can be tested.
 */

/**
 * Where `public/` is served from.
 *
 * APP_BASE_URL is the deliberate setting. The Vercel variables are the safety
 * net — injected automatically, so an unconfigured deployment still finds its
 * own assets instead of silently generating without a model.
 */
export function personaAssetOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = env.APP_BASE_URL?.trim();
  if (explicit) return stripTrailingSlashes(explicit);

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim();
  if (!vercelHost) return null;

  const withScheme = vercelHost.startsWith('http') ? vercelHost : `https://${vercelHost}`;
  return stripTrailingSlashes(withScheme);
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function personaAssetUrl(origin: string, imageUrl: string): string {
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${stripTrailingSlashes(origin)}${path}`;
}

/**
 * Whether a response actually carried an image.
 *
 * A 200 is not enough. An auth redirect lands on a login page with status 200
 * and `text/html`, and that is precisely the response that got through before.
 */
export function isUsableImageResponse(status: number, contentType: string | null): boolean {
  if (status < 200 || status >= 300) return false;
  return Boolean(contentType && contentType.toLowerCase().startsWith('image/'));
}

/**
 * The real format, read from the first bytes.
 *
 * Every persona file in public/personas is a JPEG saved with a .png extension.
 * Both the filename and the served content-type therefore say image/png while
 * the data is JFIF, and that mislabelled pair is what gets handed to Gemini.
 * The bytes are the only source here that cannot be wrong.
 *
 * Returns null when the data is not an image at all, which is the second line
 * of defence behind isUsableImageResponse.
 */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i];

  // FF D8 FF — JPEG/JFIF.
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return 'image/jpeg';
  }

  // 89 50 4E 47 0D 0A 1A 0A — PNG.
  if (
    bytes.length >= 8 &&
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return 'image/png';
  }

  // "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return 'image/webp';
  }

  // "GIF8"
  if (
    bytes.length >= 4 &&
    at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38
  ) {
    return 'image/gif';
  }

  return null;
}
