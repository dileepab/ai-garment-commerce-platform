/**
 * Photos attached to a stored chat message, and what the transcript should say
 * when the customer sent no words at all.
 *
 * Two things went wrong once images started being kept.
 *
 * The bot often sends more than one picture — a product carousel is up to four,
 * and a size-chart answer can cover two categories — but only the first was
 * recorded, so the inbox showed one image and gave no hint the others existed.
 *
 * And a photo sent with no caption was stored as "What is this item?". That
 * sentence is invented by the normalizer so the router has something to
 * classify; the customer never typed it. Recording it put words in their mouth,
 * and the support inbox then quoted those words back as the latest customer
 * message.
 *
 * Kept free of prisma and path aliases so both rules can be tested.
 */

/** Stored as JSON text because a row holds a small, ordered list of URLs. */
export function encodeMessageImages(urls: Array<string | null | undefined>): string | null {
  const cleaned = urls
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));

  // Order is meaningful: the first image is the one the reply is written about.
  const unique = [...new Set(cleaned)];

  return unique.length > 0 ? JSON.stringify(unique) : null;
}

/**
 * Reads the list back, tolerating every shape the column has held: a JSON
 * array, a bare URL from before the list existed, or nothing.
 */
export function decodeMessageImages(
  value: string | null | undefined,
  fallbackSingle?: string | null
): string[] {
  const raw = value?.trim();

  if (raw) {
    if (raw.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean);
        }
      } catch {
        // Fall through: a malformed row must not break the whole thread.
      }
    } else if (/^(?:https?:\/\/|\/)/.test(raw)) {
      // A bare URL from before the list existed. Anything else stored here is
      // not a link and must not be handed to an <img> tag.
      return [raw];
    }
  }

  const single = fallbackSingle?.trim();
  return single ? [single] : [];
}

/**
 * What to record as the customer's message.
 *
 * `routedText` is what the router was given, which may be invented. When it was
 * invented the customer sent a bare photo, and the honest transcript is the
 * photo with no words — the inbox renders the image and no bubble.
 */
export function transcriptTextFor(params: {
  routedText: string;
  wasInferred?: boolean;
}): string {
  return params.wasInferred ? '' : params.routedText;
}
