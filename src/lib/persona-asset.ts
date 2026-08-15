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
