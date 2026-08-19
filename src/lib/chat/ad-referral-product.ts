/**
 * Which item an ad click was about.
 *
 * A Click-to-WhatsApp ad opens the chat with Meta's own prefill — "Hello! Can
 * I get more info on this?" — and "this" is never sent. The ad itself is
 * captured on that first message and stored for order attribution, so the
 * headline and the ad's link are already on hand; they just were not being
 * read. Answering "What can I help you find?" to a message that says "this"
 * throws away the one thing the click told us.
 *
 * Kept free of path aliases so it can be tested.
 */

export interface AdReferralHint {
  headline?: string | null;
  sourceUrl?: string | null;
}

export interface AdMatchableProduct {
  id: number;
  name: string;
  itemCode?: string | null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words too common to identify anything on their own. */
const WEAK_TOKENS = new Set([
  'the', 'and', 'for', 'with', 'new', 'sale', 'off', 'now', 'buy', 'shop',
  'free', 'best', 'top', 'our', 'your', 'from', 'only', 'get', 'set',
]);

function strongTokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 3 && !WEAK_TOKENS.has(token));
}

/**
 * The product an ad points at, or null when the ad does not say.
 *
 * Returning null is a real answer: naming the wrong dress to someone who just
 * clicked an ad is worse than asking them which one they meant.
 */
export function resolveProductFromAdReferral(
  referral: AdReferralHint,
  products: AdMatchableProduct[]
): AdMatchableProduct | null {
  const haystackRaw = [referral.headline, decodeURIComponent(referral.sourceUrl || '')]
    .filter(Boolean)
    .join(' ');

  if (!haystackRaw.trim() || products.length === 0) return null;

  // An item code in the ad's link or headline is unambiguous, so it wins.
  const codeMatches = products.filter((product) => {
    const code = product.itemCode?.trim();
    if (!code) return false;
    return new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystackRaw);
  });
  if (codeMatches.length === 1) return codeMatches[0];

  const haystack = normalize(haystackRaw);
  if (!haystack) return null;

  // A product whose whole name appears in the ad copy.
  const named = products.filter((product) => {
    const name = normalize(product.name);
    return name.length > 0 && haystack.includes(name);
  });
  if (named.length === 1) return named[0];

  // Otherwise score on distinctive words, and only trust a clear winner.
  const scored = products
    .map((product) => {
      const tokens = strongTokens(product.name);
      const hits = tokens.filter((token) => haystack.includes(token)).length;
      return { product, hits, needed: tokens.length };
    })
    .filter((entry) => entry.hits >= 2)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 0) return null;

  // Two products matching equally well means the ad named a family, not an
  // item — "Smocked Sundress" covers three colourways here.
  if (scored.length > 1 && scored[0].hits === scored[1].hits) return null;

  return scored[0].product;
}

/**
 * The opening line for someone who arrived from an ad we can identify.
 *
 * `introduce` says this is an AI. Most ad arrivals never see a greeting at all
 * — this reply takes its place — so leaving it out here would skip the
 * disclosure for the channel bringing in the most customers.
 */
export function buildAdArrivalReply(params: {
  customerName?: string | null;
  brandName: string;
  productName: string;
  itemCode?: string | null;
  price: string;
  sizes: string;
  introduce?: boolean;
}): string {
  const name = params.customerName?.trim();
  const greeting = params.introduce
    ? name
      ? `Hi ${name}, you are chatting with ${params.brandName}'s AI assistant.`
      : `You are chatting with ${params.brandName}'s AI assistant.`
    : name
      ? `Hi ${name}, welcome to ${params.brandName}.`
      : `Welcome to ${params.brandName}.`;

  const lines = [
    `${greeting} The item in that ad is ${params.productName} — ${params.price}.`,
  ];
  if (params.sizes) lines.push(`Sizes: ${params.sizes}`);
  if (params.itemCode) lines.push(`Item code: ${params.itemCode}`);
  lines.push('Happy to send photos or take your order.');

  return lines.join('\n');
}
