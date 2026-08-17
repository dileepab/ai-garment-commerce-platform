import { sortSizes } from './size-order.ts';

/**
 * The item details block that rides along with a published post.
 *
 * Every photo carries the details of the item it shows, and the caption repeats
 * all of them. That matters most for a post covering several items: the picture
 * a shopper stops on has to be able to tell them what it is and what it costs,
 * because the caption below is describing three dresses at once.
 *
 * Details are read from the product row at publish time rather than from
 * whatever was typed while drafting, so a price or a size range edited after
 * the draft was written still goes out correct.
 *
 * Kept free of prisma and path aliases so the formatting can be tested.
 */

export interface PostItemProduct {
  id: number;
  sku: string | null;
  brand: string;
  name: string;
  price: number;
  sizes: string;
  colors: string;
  variants: Array<{ sku: string | null }>;
}

function cleanDetailValue(value?: string | null): string {
  const cleaned = value?.trim();
  return cleaned || 'N/A';
}

export function formatRsPrice(price?: number | null): string {
  return typeof price === 'number' && Number.isFinite(price)
    ? `Rs ${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : 'N/A';
}

/**
 * Sizes as one display string. The ordering itself lives in size-order, so a
 * caption and the storefront cannot drift apart; this only splits, removes
 * duplicates and joins.
 *
 * Sizes are typed by hand on the product row, so they arrive in whatever order
 * they were entered — "L,M,S,XL" went out on a live post.
 */
export function formatSizes(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const seen = new Set<string>();
  const sizes = raw
    .split(/[,/|]/)
    .map((size) => size.trim())
    .filter((size) => {
      if (!size) return false;
      const key = size.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (sizes.length === 0) return null;

  return sortSizes(sizes).join(', ');
}

/** Mirrors productSkuPrefix — three letters of the brand, uppercased. */
function productSkuPrefix(brand: string): string {
  const prefix = brand.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase();
  return prefix || 'SKU';
}

export function postItemCode(product: PostItemProduct): string {
  const stored = product.sku?.trim();
  if (stored) return stored;

  return `${productSkuPrefix(product.brand)}-${String(product.id).padStart(4, '0')}`;
}

export function parseProductContextValue(
  context: string | null | undefined,
  label: string
): string | null {
  if (!context) return null;
  const match = context.match(new RegExp(`${label}:\\s*([^.]+)`, 'i'));
  return match?.[1]?.trim() || null;
}

/**
 * One item's details, from the product row where there is one.
 *
 * Creatives predating the product link fall back to the context typed while
 * drafting, and to the stored description after that — an older post should
 * still publish with whatever it does know rather than a block of "N/A".
 */
export function buildItemDescription(input: {
  fallbackDescription?: string | null;
  productContext?: string | null;
  product?: PostItemProduct | null;
}): string {
  const product = input.product;
  const itemName = product?.name ?? parseProductContextValue(input.productContext, 'Name');
  const variantCode = product?.variants
    .map((variant) => variant.sku?.trim())
    .find((sku): sku is string => Boolean(sku));
  const itemCode = product ? postItemCode(product) : variantCode ?? null;
  const sizes = product?.sizes ?? parseProductContextValue(input.productContext, 'Sizes');
  const colors = product?.colors ?? parseProductContextValue(input.productContext, 'Colors');
  const price = product
    ? formatRsPrice(product.price)
    : cleanDetailValue(parseProductContextValue(input.productContext, 'Price'));

  if (!itemName && !itemCode && !sizes && !colors && price === 'N/A') {
    const fallback = input.fallbackDescription?.trim();
    return fallback && fallback.toUpperCase() !== 'N/A' ? fallback : '';
  }

  return [
    `Item Name: ${cleanDetailValue(itemName)}`,
    `Item Code: ${cleanDetailValue(itemCode)}`,
    `Available Sizes: ${cleanDetailValue(formatSizes(sizes))}`,
    `Available Colors: ${cleanDetailValue(colors)}`,
    `Item Price: ${price}`,
  ].join('\n');
}

interface ParsedItemDetails {
  name: string;
  code: string;
  sizes: string;
  colors: string;
  price: string;
}

const DETAIL_LABELS = [
  'Item Name',
  'Item Code',
  'Available Sizes',
  'Available Colors',
  'Item Price',
] as const;

/** Reads back a block this module rendered; anything else returns null. */
function parseItemDescription(block: string): ParsedItemDetails | null {
  const lines = block.split('\n').map((line) => line.trim());
  if (lines.length !== DETAIL_LABELS.length) return null;

  const values: string[] = [];
  for (const [index, label] of DETAIL_LABELS.entries()) {
    if (!lines[index].startsWith(`${label}:`)) return null;
    values.push(lines[index].slice(label.length + 1).trim());
  }

  return { name: values[0], code: values[1], sizes: values[2], colors: values[3], price: values[4] };
}

/** "Tie-Strap Smocked Sundress — Blue Grey" -> "Tie-Strap Smocked Sundress". */
function baseItemName(name: string): string {
  return name.split(/\s+[—–-]\s+/)[0].trim() || name.trim();
}

/**
 * Colourways of one dress are separate products, so they publish as blocks that
 * differ only in the colour and the code — three of them under one caption read
 * like a stutter. Where the style, sizes and price all match they become a
 * single block that still names every colour with its own code, so a shopper
 * can order the exact one.
 */
function collapseSharedItems(blocks: string[]): string[] {
  const groups: Array<{ key: string; items: ParsedItemDetails[]; raw: string }> = [];

  for (const block of blocks) {
    const parsed = parseItemDescription(block);
    if (!parsed) {
      groups.push({ key: `unparsed:${groups.length}`, items: [], raw: block });
      continue;
    }

    const key = [baseItemName(parsed.name), parsed.sizes, parsed.price].join('|').toLowerCase();
    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.items.push(parsed);
    } else {
      groups.push({ key, items: [parsed], raw: block });
    }
  }

  return groups.map((group) => {
    if (group.items.length <= 1) return group.raw;

    const [first] = group.items;
    const colors = group.items
      .map((item) => (item.code && item.code !== 'N/A' ? `${item.colors} (${item.code})` : item.colors))
      .join(', ');

    return [
      `Item Name: ${baseItemName(first.name)}`,
      `Available Sizes: ${first.sizes}`,
      `Available Colors: ${colors}`,
      `Item Price: ${first.price}`,
    ].join('\n');
  });
}

/**
 * Appends every item's details to the caption.
 *
 * Deduplicated because several photos of one dress share its details and a
 * caption repeating the same block three times reads like a bug. A caption that
 * already carries a details block is left alone, so re-publishing does not
 * stack them.
 */
export function appendItemDescriptions(caption: string, descriptions: string[]): string {
  const cleanCaption = caption.trim();
  if (cleanCaption.includes('Item Name:')) {
    return cleanCaption;
  }

  const uniqueDescriptions = Array.from(
    new Set(
      descriptions
        .map((description) => description.trim())
        .filter((description) => Boolean(description) && description.toUpperCase() !== 'N/A')
    )
  );

  if (uniqueDescriptions.length === 0) {
    return cleanCaption;
  }

  return `${cleanCaption}\n\n${collapseSharedItems(uniqueDescriptions).join('\n\n')}`;
}
