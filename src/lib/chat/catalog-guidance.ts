import { isVariantAvailable, variantAvailableQty } from '../variant-availability.ts';
import { messageMentionsItemCode } from '../product-item-code.ts';

export interface CatalogGuidanceProduct {
  id: number;
  name: string;
  brand?: string | null;
  sku?: string | null;
  price: number;
  style?: string | null;
  fabric?: string | null;
  sizes: string;
  colors: string;
  stock?: number | null;
  inventory?: { availableQty: number } | null;
  variants?: Array<{
    size: string;
    color: string;
    status?: string | null;
    inventory?: { availableQty: number } | null;
  }>;
}

export interface CatalogRecommendationResult {
  products: CatalogGuidanceProduct[];
  exactMatch: boolean;
  requestedBudget: number | null;
  requestedColors: string[];
  requestedSizes: string[];
}

export interface CatalogRecommendationConstraints {
  maximumPrice: number | null;
  colors: string[];
  sizes: string[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitOptions(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueOptions(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const COLOR_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'Black', aliases: ['black', 'kalu', 'කළු', 'karuppu', 'கருப்பு'] },
  { canonical: 'White', aliases: ['white', 'sudu', 'සුදු', 'vellai', 'வெள்ளை'] },
  { canonical: 'Grey', aliases: ['grey', 'gray', 'alu', 'අළු', 'sambal', 'சாம்பல்'] },
  { canonical: 'Beige', aliases: ['beige', 'bej', 'බේජ්', 'beej', 'பேஜ்'] },
  { canonical: 'Pink', aliases: ['pink', 'rosa', 'රෝස', 'ilanchivappu', 'இளஞ்சிவப்பு'] },
  { canonical: 'Coral', aliases: ['coral'] },
  { canonical: 'Sage', aliases: ['sage'] },
  { canonical: 'Cream', aliases: ['cream', 'ක්‍රීම්', 'க்ரீம்'] },
  { canonical: 'Blue', aliases: ['blue', 'nil', 'නිල්', 'neelam', 'நீலம்'] },
  { canonical: 'Red', aliases: ['red', 'rathu', 'රතු', 'sivappu', 'சிவப்பு'] },
  { canonical: 'Green', aliases: ['green', 'kola', 'කොළ', 'pachai', 'பச்சை'] },
  { canonical: 'Brown', aliases: ['brown', 'dumburu', 'දුඹුරු', 'paluppu', 'பழுப்பு'] },
  { canonical: 'Purple', aliases: ['purple', 'dam', 'දම්', 'oodha', 'ஊதா'] },
  { canonical: 'Yellow', aliases: ['yellow', 'kaha', 'කහ', 'manjal', 'மஞ்சள்'] },
  { canonical: 'Orange', aliases: ['orange', 'thambili', 'තැඹිලි', 'ஆரஞ்சு'] },
  { canonical: 'Navy', aliases: ['navy'] },
  { canonical: 'Maroon', aliases: ['maroon'] },
];

function colorKey(value: string): string {
  const normalizedValue = normalize(value);
  const matchedAlias = COLOR_ALIASES.find((entry) =>
    entry.aliases.some((alias) => normalize(alias) === normalizedValue)
  );

  return normalize(matchedAlias?.canonical ?? value);
}

function sizeKey(value: string): string {
  const normalizedValue = value.trim().toUpperCase();
  return normalizedValue === 'XXL' ? '2XL' : normalizedValue;
}

function includesPhrase(message: string, phrase: string): boolean {
  const normalizedMessage = ` ${normalize(message)} `;
  const normalizedPhrase = normalize(phrase);
  return Boolean(normalizedPhrase) && normalizedMessage.includes(` ${normalizedPhrase} `);
}

function formatPrice(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

function humanizeLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function availableOptions(
  product: CatalogGuidanceProduct,
  field: 'size' | 'color'
): string[] {
  if (product.variants && product.variants.length > 0) {
    return uniqueOptions(
      product.variants
        .filter(isVariantAvailable)
        .map((variant) => variant[field])
    );
  }

  return splitOptions(field === 'size' ? product.sizes : product.colors);
}

function formatProductFacts(product: CatalogGuidanceProduct): string {
  const facts = [
    product.fabric?.trim() || null,
    `Sizes ${availableOptions(product, 'size').join(', ') || '-'}`,
    `Colors ${availableOptions(product, 'color').join(', ') || '-'}`,
  ].filter((value): value is string => Boolean(value));

  return facts.join(' · ');
}

function extractBudget(message: string): number | null {
  const match = message.match(
    /\b(?:under|below|less than|up to|maximum|max|budget(?:\s+is|\s+of)?)\s*(?:rs\.?|lkr)?\s*([\d,]+)\b/i
  ) || message.match(/\b(?:rs\.?|lkr)\s*([\d,]+)\s*(?:or less|maximum|max)\b/i) ||
    message.match(
      /(?:rs\.?|lkr|රු\.?)?\s*([\d,]+)\s*(?:ta\s+aduw(?:en|ata)?|yata\s+aduw?(?:en)?|kulla|ku\s+keela|ට\s*අඩු(?:වෙන්)?|க்குள்|க்கு\s*கீழ்)/i
    );

  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function allKnownOptions(
  products: CatalogGuidanceProduct[],
  field: 'sizes' | 'colors'
): string[] {
  return uniqueOptions(products.flatMap((product) => splitOptions(product[field])));
}

function requestedColors(message: string, products: CatalogGuidanceProduct[]): string[] {
  const catalogColors = allKnownOptions(products, 'colors');
  const directlyMentioned = catalogColors.filter((color) => includesPhrase(message, color));
  const aliasedColors = COLOR_ALIASES.filter((entry) =>
    entry.aliases.some((alias) => includesPhrase(message, alias))
  ).map((entry) => {
    return catalogColors.find((color) => colorKey(color) === colorKey(entry.canonical)) ?? entry.canonical;
  });

  return uniqueOptions([...directlyMentioned, ...aliasedColors]);
}

function requestedSizes(message: string, products: CatalogGuidanceProduct[]): string[] {
  const options = allKnownOptions(products, 'sizes');
  const catalogMatches = options.filter((size) => {
    const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\bsize\\s*(?:is\\s*)?(?:[:=-]\\s*)?${escaped}\\b`, 'i').test(message) ||
      new RegExp(`\\b${escaped}\\s+size\\b`, 'i').test(message);
  });
  const standardMatch = message.match(/\b(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|6XL)\b/i);
  const standardSize = standardMatch?.[1] ? sizeKey(standardMatch[1]) : null;
  const catalogStandardSize = standardSize
    ? options.find((size) => sizeKey(size) === standardSize) ?? standardSize
    : null;

  return uniqueOptions([
    ...catalogMatches,
    ...(catalogStandardSize ? [catalogStandardSize] : []),
  ]);
}

function productMatchesVariantConstraints(
  product: CatalogGuidanceProduct,
  colors: string[],
  sizes: string[]
): boolean {
  const availableVariants = (product.variants ?? []).filter(isVariantAvailable);

  if (availableVariants.length > 0 && (colors.length > 0 || sizes.length > 0)) {
    return availableVariants.some(
      (variant) =>
        (colors.length === 0 || colors.some((color) => colorKey(variant.color) === colorKey(color))) &&
        (sizes.length === 0 || sizes.some((size) => sizeKey(variant.size) === sizeKey(size)))
    );
  }

  const productColors = availableOptions(product, 'color').map(colorKey);
  const productSizes = availableOptions(product, 'size').map(sizeKey);
  return (
    (colors.length === 0 || colors.some((color) => productColors.includes(colorKey(color)))) &&
    (sizes.length === 0 || sizes.some((size) => productSizes.includes(sizeKey(size))))
  );
}

function heatWeatherScore(product: CatalogGuidanceProduct): number {
  const text = normalize(`${product.name} ${product.style ?? ''} ${product.fabric ?? ''}`);
  let score = 0;

  if (text.includes('linen')) score += 8;
  if (text.includes('rayon')) score += 7;
  if (text.includes('cotton')) score += 6;
  if (text.includes('summer')) score += 5;
  if (text.includes('breezy')) score += 4;
  if (text.includes('relaxed')) score += 1;

  return score;
}

function hasHotWeatherIntent(message: string): boolean {
  const normalizedMessage = normalize(message);
  return (
    /\b(?:hot|warm|summer|cool|heat|sunny)\b/.test(normalizedMessage) ||
    /(ගිම්හාන|උණුසුම්|රස්නෙ|රස්නේ|සිසිල්)/.test(message) ||
    /(வெயில்|கோடை|சூடு|குளிர்ச்சியான)/.test(message)
  );
}

function hasLightweightIntent(message: string): boolean {
  const normalizedMessage = normalize(message);
  return (
    /\b(?:light|lightweight|breezy|airy)\b/.test(normalizedMessage) ||
    /(සැහැල්ලු|හීනි|හුළං)/.test(message) ||
    /(லேசான|இலகுவான|காற்றோட்டமான)/.test(message)
  );
}

function hasComfortIntent(message: string): boolean {
  const normalizedMessage = normalize(message);
  return (
    /\b(?:comfortable|comfy|casual|relaxed|travelling|traveling|travel)\b/.test(
      normalizedMessage
    ) ||
    /(සුවපහසු|කැෂුවල්|ගමන්|සැහැල්ලු)/.test(message) ||
    /(வசதியான|கேஷுவல்|பயணம்|லேசான)/.test(message)
  );
}

function relaxedFitScore(product: CatalogGuidanceProduct): number {
  const text = normalize(`${product.name} ${product.style ?? ''}`);
  let score = 0;

  if (text.includes('oversized')) score += 8;
  if (text.includes('relaxed')) score += 7;
  if (text.includes('casual')) score += 5;
  if (text.includes('pants')) score += 1;
  if (text.includes('crop')) score -= 2;

  return score;
}

function recommendationScore(product: CatalogGuidanceProduct, message: string): number {
  const normalizedMessage = normalize(message);
  const productText = normalize(
    `${product.name} ${product.style ?? ''} ${product.fabric ?? ''} ${product.colors}`
  );
  let score = 0;

  if (hasHotWeatherIntent(message)) {
    score += heatWeatherScore(product);
  }

  if (hasLightweightIntent(message)) {
    if (/\b(?:linen|rayon|cotton)\b/.test(productText)) score += 4;
    if (/\b(?:breezy|summer)\b/.test(productText)) score += 3;
  }

  if (hasComfortIntent(message)) {
    if (/\b(?:relaxed|oversized|casual|breezy)\b/.test(productText)) score += 5;
    if (/\b(?:linen|rayon|cotton)\b/.test(productText)) score += 2;
  }

  const ignoredTokens = new Set([
    'something', 'would', 'could', 'please', 'recommend', 'suggest', 'looking',
    'under', 'below', 'with', 'what', 'which', 'need', 'want', 'have', 'show',
  ]);
  for (const token of normalizedMessage.split(' ')) {
    if (token.length > 3 && !ignoredTokens.has(token) && productText.includes(token)) {
      score += 2;
    }
  }

  return score;
}

export function looksLikeRecommendationRequest(message: string): boolean {
  const normalizedMessage = normalize(message);
  return (
    /\b(?:recommend|recommendation|suggest|suggestion|help me (?:choose|pick)|what should i (?:buy|wear|choose)|best (?:choice|option|item)|looking for|need something|want something|something)\b/.test(
      normalizedMessage
    ) ||
    /\b(?:need|want|find me|show me|any)\b.*\b(?:clothes?|outfit|top|dress|pants?|skirt|item|option)\b/.test(
      normalizedMessage
    ) ||
    /\b(?:mata|mama)\b.*\b(?:ona|one|adinna|ganna)\b/.test(normalizedMessage) ||
    /\b(?:enakku|naan)\b.*\b(?:venum|vendaum|podanum|vaanganum)\b/.test(
      normalizedMessage
    ) ||
    /(නිර්දේශ|යෝජනා).*(ඇඳුම|ඇදුම|ඇඳුම්|ඇදුම්)|(?:ඇඳුම|ඇදුම|ඇඳුම්|ඇදුම්).*(නිර්දේශ|යෝජනා)/.test(
      message
    ) ||
    /(பரிந்துரை|சிபாரிசு).*(உடை|ஆடை|துணி)|(?:உடை|ஆடை|துணி).*(பரிந்துரை|சிபாரிசு)/.test(
      message
    )
  );
}

export function looksLikeShortlistFollowUp(message: string): boolean {
  const normalizedMessage = normalize(message);
  return (
    /\b(?:which|what) (?:one|item) (?:of )?(?:those|these|them)\b/.test(normalizedMessage) ||
    /\b(?:best|coolest|lightest|cheapest|most comfortable) (?:one|item)\b/.test(
      normalizedMessage
    ) ||
    /(ඒවායින්|මේවායින්|එයින්).*(හොඳ|සිසිල්|සැහැල්ලු|අඩු)/.test(message) ||
    /(அவற்றில்|இவற்றில்).*(சிறந்த|குளிர்|லேசான|மலிவான)/.test(message)
  );
}

export function looksLikeProductComparison(message: string): boolean {
  const normalizedMessage = normalize(message);
  return (
    /\b(?:compare|comparison|versus|vs|difference|which is better|which one is better|better for)\b/.test(
      normalizedMessage
    ) ||
    /(සසඳ|දෙකෙන්|වඩා\s*හොඳ)/.test(message) ||
    /(ஒப்பிடு|இரண்டில்|எது\s*சிறந்த)/.test(message)
  );
}

export function findMentionedCatalogProducts(
  message: string,
  products: CatalogGuidanceProduct[]
): CatalogGuidanceProduct[] {
  const byItemCode = products.filter((product) => messageMentionsItemCode(message, product));
  if (byItemCode.length > 0) {
    return byItemCode;
  }

  return [...products]
    .sort((left, right) => right.name.length - left.name.length)
    .filter((product) => includesPhrase(message, product.name));
}

export function rankCatalogRecommendations(
  products: CatalogGuidanceProduct[],
  message: string,
  limit = 3
): CatalogRecommendationResult {
  const budget = extractBudget(message);
  const colors = requestedColors(message, products);
  const sizes = requestedSizes(message, products);
  const exactCandidates = products.filter((product) => {
    return (
      (budget === null || product.price <= budget) &&
      productMatchesVariantConstraints(product, colors, sizes)
    );
  });
  const exactMatch = exactCandidates.length > 0;
  const candidates = exactMatch ? exactCandidates : products;
  const ranked = [...candidates]
    .map((product) => ({ product, score: recommendationScore(product, message) }))
    .sort((left, right) => right.score - left.score || left.product.price - right.product.price)
    .slice(0, Math.max(1, Math.min(limit, 3)))
    .map(({ product }) => product);

  return {
    products: ranked,
    exactMatch,
    requestedBudget: budget,
    requestedColors: colors,
    requestedSizes: sizes,
  };
}

function recommendationReason(
  product: CatalogGuidanceProduct,
  message: string,
  result: CatalogRecommendationResult
): string {
  const reasons: string[] = [];
  const productText = normalize(`${product.name} ${product.style ?? ''} ${product.fabric ?? ''}`);

  if (result.requestedBudget !== null && product.price <= result.requestedBudget) {
    reasons.push('within your budget');
  }
  const matchingColor = result.requestedColors.find((color) =>
    availableOptions(product, 'color').some((option) => colorKey(option) === colorKey(color))
  );
  if (matchingColor) reasons.push(`available in ${matchingColor}`);
  if (hasHotWeatherIntent(message) || hasLightweightIntent(message)) {
    if (/\b(?:summer|breezy|linen|rayon|cotton)\b/.test(productText)) {
      reasons.push(
        `strong warm-weather match based on its recorded ${product.fabric || 'material'} fabric${
          product.style ? ` and ${humanizeLabel(product.style)} style` : ''
        }`
      );
    }
  }
  if (hasComfortIntent(message) &&
      /\b(?:relaxed|oversized|casual|breezy)\b/.test(productText)) {
    reasons.push('a relaxed choice for a casual day');
  }

  return reasons.length > 0
    ? `${reasons[0][0].toUpperCase()}${reasons[0].slice(1)}${
        reasons.length > 1 ? `; ${reasons.slice(1).join('; ')}` : ''
      }.`
    : 'A good match from the currently available catalog.';
}

export function buildCatalogRecommendationReply(
  products: CatalogGuidanceProduct[],
  message: string
): {
  reply: string;
  products: CatalogGuidanceProduct[];
  constraints: CatalogRecommendationConstraints;
} {
  const result = rankCatalogRecommendations(products, message);
  const constraints = {
    maximumPrice: result.requestedBudget,
    colors: result.requestedColors,
    sizes: result.requestedSizes,
  };

  if (result.products.length === 0) {
    return {
      reply: 'I could not find an in-stock item that matches that request right now.',
      products: [],
      constraints,
    };
  }

  const intro = result.exactMatch
    ? result.products.length === 1
      ? 'The best match I found is:'
      : 'Here are my best matches:'
    : 'I could not find an in-stock item matching every detail. These are the closest options:';
  const lines = result.products.flatMap((product, index) => [
    `${index + 1}. ${product.name} — Rs ${formatPrice(product.price)}`,
    `   ${formatProductFacts(product)}`,
    `   ${recommendationReason(product, message, result)}`,
  ]);

  return {
    reply: [intro, '', ...lines, '', `My first pick would be ${result.products[0].name}.`].join('\n'),
    products: result.products,
    constraints,
  };
}

export function buildShortlistRecommendationReply(
  products: CatalogGuidanceProduct[],
  message: string
): { reply: string; preferredProduct: CatalogGuidanceProduct } | null {
  if (products.length < 2 || !looksLikeShortlistFollowUp(message)) return null;

  const result = rankCatalogRecommendations(products, message, 1);
  const preferredProduct = result.products[0];
  if (!preferredProduct) return null;
  const reason = recommendationReason(
    preferredProduct,
    message,
    result
  );
  const hasHardConstraints =
    result.requestedBudget !== null ||
    result.requestedColors.length > 0 ||
    result.requestedSizes.length > 0;

  if (!result.exactMatch && hasHardConstraints) {
    return {
      reply: `None of those options matches the new budget, color, and size requirements exactly. The closest option is ${preferredProduct.name} — Rs ${formatPrice(
        preferredProduct.price
      )}. ${formatProductFacts(preferredProduct)}.`,
      preferredProduct,
    };
  }

  return {
    reply: `Of those options, I would choose ${preferredProduct.name}. ${formatProductFacts(
      preferredProduct
    )}. ${reason}`,
    preferredProduct,
  };
}

export function buildProductComparisonReply(
  products: CatalogGuidanceProduct[],
  message: string
): { reply: string; preferredProduct: CatalogGuidanceProduct } | null {
  const mentioned = findMentionedCatalogProducts(message, products).slice(0, 2);
  if (mentioned.length < 2 || !looksLikeProductComparison(message)) return null;

  const [first, second] = mentioned;
  const normalizedMessage = normalize(message);
  let conclusion: string;
  let preferredProduct: CatalogGuidanceProduct;

  if (hasHotWeatherIntent(message)) {
    const firstScore = heatWeatherScore(first);
    const secondScore = heatWeatherScore(second);
    preferredProduct = firstScore >= secondScore ? first : second;
    const otherProduct = preferredProduct.id === first.id ? second : first;
    conclusion = `For hot weather, I would lean toward ${preferredProduct.name}, based on its recorded ${preferredProduct.fabric || 'material'} fabric and ${humanizeLabel(preferredProduct.style || 'garment')} style. ${otherProduct.name} is still a good alternative if you prefer its shape and colors.`;
  } else if (/\b(?:relaxed|casual|comfortable|comfy)\b/.test(normalizedMessage)) {
    const firstScore = relaxedFitScore(first);
    const secondScore = relaxedFitScore(second);
    preferredProduct = firstScore >= secondScore ? first : second;
    const otherProduct = preferredProduct.id === first.id ? second : first;
    conclusion = `For a relaxed casual fit, I would choose ${preferredProduct.name} because its recorded ${humanizeLabel(
      preferredProduct.style || 'garment'
    )} style is the stronger match. ${otherProduct.name} is the better option if you prefer its more fitted shape.`;
  } else {
    preferredProduct = first.price <= second.price ? first : second;
    const difference = Math.abs(first.price - second.price);
    conclusion = difference > 0
      ? `${preferredProduct.name} is the lower-priced option by Rs ${formatPrice(difference)}. The better choice otherwise depends on the fabric, shape, and colors you prefer.`
      : 'They are the same price, so the better choice depends on the fabric, shape, and colors you prefer.';
  }

  return {
    reply: [
      'Here is a quick comparison:',
      '',
      `• ${first.name} — Rs ${formatPrice(first.price)} · ${formatProductFacts(first)}`,
      `• ${second.name} — Rs ${formatPrice(second.price)} · ${formatProductFacts(second)}`,
      '',
      conclusion,
    ].join('\n'),
    preferredProduct,
  };
}

function canonicalOption(value: string | null | undefined, options: string[]): string | null {
  if (!value?.trim()) return null;
  return options.find((option) => normalize(option) === normalize(value)) ?? value.trim();
}

function inferSizeFromMessage(message: string, options: string[]): string | null {
  for (const size of options) {
    const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\bsize\\s*(?:is\\s*)?(?:[:=-]\\s*)?${escaped}\\b`, 'i').test(message) ||
        new RegExp(`\\b${escaped}\\s+size\\b`, 'i').test(message)) {
      return size;
    }
  }

  const standardSizeMatch =
    message.match(/\bsize\s*(?:is\s*)?(?:[:=-]\s*)?(xs|s|m|l|xl|xxl|2xl|3xl|4xl)\b/i) ||
    message.match(/\b(xs|s|m|l|xl|xxl|2xl|3xl|4xl)\s+size\b/i);

  if (standardSizeMatch?.[1]) {
    const requestedKey = sizeKey(standardSizeMatch[1]);
    return options.find((option) => sizeKey(option) === requestedKey) ?? requestedKey;
  }

  for (const size of [...options].sort((left, right) => right.length - left.length)) {
    const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[\\s,(/-])${escaped}(?=$|[\\s,).?!/-])`, 'i').test(message)) {
      return size;
    }
  }

  return null;
}

function inferColorFromMessage(message: string, options: string[]): string | null {
  const directMatch = options.find((color) => includesPhrase(message, color));
  if (directMatch) return directMatch;

  const aliasMatch = COLOR_ALIASES.find((entry) =>
    entry.aliases.some((alias) => includesPhrase(message, alias))
  );
  return aliasMatch
    ? options.find((color) => colorKey(color) === colorKey(aliasMatch.canonical)) ?? null
    : null;
}

export function resolveRequestedVariant(
  product: CatalogGuidanceProduct,
  message: string,
  requestedSize?: string | null,
  requestedColor?: string | null
): { size: string | null; color: string | null } {
  const sizes = uniqueOptions([
    ...splitOptions(product.sizes),
    ...(product.variants ?? []).map((variant) => variant.size),
  ]);
  const colors = uniqueOptions([
    ...splitOptions(product.colors),
    ...(product.variants ?? []).map((variant) => variant.color),
  ]);

  return {
    size: canonicalOption(requestedSize, sizes) ?? inferSizeFromMessage(message, sizes),
    color:
      (requestedColor
        ? colors.find((color) => colorKey(color) === colorKey(requestedColor)) ?? null
        : null) ?? inferColorFromMessage(message, colors),
  };
}

export function buildUnavailableVariantReply(
  product: CatalogGuidanceProduct,
  requestedSize?: string | null,
  requestedColor?: string | null
): string | null {
  if (!requestedSize && !requestedColor) return null;

  const variants = product.variants ?? [];
  const availableVariants = variants.filter(isVariantAvailable);
  const sizeMatches = (value: string) =>
    !requestedSize || normalize(value) === normalize(requestedSize);
  const colorMatches = (value: string) =>
    !requestedColor || normalize(value) === normalize(requestedColor);

  if (variants.length > 0) {
    if (availableVariants.some((variant) => sizeMatches(variant.size) && colorMatches(variant.color))) {
      return null;
    }

    const requestLabel = [
      requestedColor,
      requestedSize ? `size ${requestedSize}` : null,
    ].filter(Boolean).join(', ');
    const alternativesForColor = requestedColor
      ? availableVariants.filter((variant) => colorMatches(variant.color))
      : [];
    const alternativesForSize = requestedSize
      ? availableVariants.filter((variant) => sizeMatches(variant.size))
      : [];
    let alternativeText: string;

    if (alternativesForColor.length > 0) {
      alternativeText = `${alternativesForColor[0].color} is available in sizes ${uniqueOptions(alternativesForColor.map((variant) => variant.size)).join(', ')}.`;
    } else if (alternativesForSize.length > 0) {
      alternativeText = `Size ${alternativesForSize[0].size} is available in ${uniqueOptions(alternativesForSize.map((variant) => variant.color)).join(', ')}.`;
    } else if (availableVariants.length > 0) {
      const combinations = availableVariants
        .slice(0, 6)
        .map((variant) => `${variant.color} / ${variant.size}`);
      alternativeText = `Available alternatives are ${combinations.join(', ')}.`;
    } else {
      alternativeText = 'This item is currently out of stock in every variant.';
    }

    return `Sorry, ${product.name} in ${requestLabel} is not available right now. ${alternativeText}`;
  }

  const sizes = splitOptions(product.sizes);
  const colors = splitOptions(product.colors);
  const hasRequestedSize = !requestedSize || sizes.some(sizeMatches);
  const hasRequestedColor = !requestedColor || colors.some(colorMatches);
  const hasProductStock = (product.inventory?.availableQty ?? product.stock ?? 0) > 0;

  if (hasRequestedSize && hasRequestedColor && hasProductStock) return null;

  const requestLabel = [
    requestedColor,
    requestedSize ? `size ${requestedSize}` : null,
  ].filter(Boolean).join(', ');
  return `Sorry, ${product.name} in ${requestLabel} is not available right now. Available sizes: ${sizes.join(', ') || 'none'}. Available colors: ${colors.join(', ') || 'none'}.`;
}

export function buildAvailableVariantReply(
  product: CatalogGuidanceProduct,
  requestedSize: string | null,
  requestedColor: string | null,
  message: string
): string | null {
  if (!requestedSize && !requestedColor) return null;

  const asksAvailability =
    /\b(?:available|availability|stock|in stock|how many|left|do (?:you|u)(?: guys)? have|have you got|come in|comes in)\b/i.test(
      message
    ) ||
    // "M thiyeida" — Singlish for "is M available?" — matched nothing, so a
    // question about one size was answered with the whole overview.
    /(තියෙනවද|තිබෙනවද|තියෙයිද|තියේද|ලබාගන්න|கிடைக்குமா|இருக்கிறதா|கையிருப்பு)/i.test(message) ||
    /\b(?:thiy|tiy)[aeiy]\w*/i.test(message);

  if (!asksAvailability) return null;

  const variants = (product.variants ?? []).filter(isVariantAvailable);
  if (variants.length === 0) return null;

  const matches = variants.filter(
    (variant) =>
      (!requestedSize || normalize(variant.size) === normalize(requestedSize)) &&
      (!requestedColor || normalize(variant.color) === normalize(requestedColor))
  );
  const availableQty = matches.reduce(
    (sum, variant) => sum + variantAvailableQty(variant),
    0
  );

  if (availableQty <= 0) return null;

  const variantLabel = [
    requestedColor,
    requestedSize ? `size ${requestedSize}` : null,
  ].filter(Boolean).join(', ');

  // Confirming the exact colour and size they asked for is the answer. The
  // count used to be printed twice over — "Available stock: 2 (2 items for that
  // selection)" — and it was never the customer's number to begin with.
  return `Yes, ${product.name} is available in ${variantLabel}.`;
}
