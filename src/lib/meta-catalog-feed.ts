import { creativeImagePath, CATALOG_TTL_SECONDS } from './creative-image-token.ts';

export const META_CATALOG_FEED_COLUMNS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'brand',
  'item_group_id',
  'color',
  'size',
] as const;

const META_ID_MAX_LENGTH = 100;
const META_TITLE_MAX_LENGTH = 200;
const META_DESCRIPTION_MAX_LENGTH = 9_999;
const META_BRAND_MAX_LENGTH = 100;
const META_VARIANT_ATTRIBUTE_MAX_LENGTH = 200;

export type MetaCatalogBrand = {
  key: 'happybuy' | 'cleopatra' | 'modabella';
  platformName: 'Happybuy' | 'Cleopatra' | 'Modabella';
  databaseNames: string[];
  storefrontOrigin: string;
};

const CATALOG_BRANDS: Record<MetaCatalogBrand['key'], MetaCatalogBrand> = {
  happybuy: {
    key: 'happybuy',
    platformName: 'Happybuy',
    databaseNames: ['Happybuy', 'Happyby', 'Happy Buy', 'happybuy', 'happyby'],
    storefrontOrigin: 'https://happybuyfashion.com',
  },
  cleopatra: {
    key: 'cleopatra',
    platformName: 'Cleopatra',
    databaseNames: ['Cleopatra', 'cleopatra'],
    storefrontOrigin: 'https://cleopatraforever.com',
  },
  modabella: {
    key: 'modabella',
    platformName: 'Modabella',
    databaseNames: ['Modabella', 'modabella'],
    storefrontOrigin: 'https://lovemodabella.com',
  },
};

export type MetaCatalogFeedProduct = {
  id: number;
  sku: string | null;
  name: string;
  brand: string;
  style: string | null;
  price: number;
  fabric: string | null;
  sizes: string | null;
  colors: string | null;
  stock: number | null;
  status: string | null;
  imageUrl: string | null;
  fitType?: string | null;
  inventory?: { availableQty: number } | null;
  variants?: Array<{
    id: number;
    sku?: string | null;
    size?: string | null;
    color?: string | null;
    priceOverride?: number | null;
    status: string | null;
    inventory?: { availableQty: number } | null;
  }>;
  colorImages?: Array<{ color?: string | null; imageUrl: string }>;
  creatives?: Array<{ id: number; status?: string | null; imageUrl?: string | null }>;
};

export type MetaCatalogFeedRow = Record<(typeof META_CATALOG_FEED_COLUMNS)[number], string>;

export type MetaCatalogProduct = {
  sku: string;
  retailerId: string;
  title: string;
  description: string;
  availability: 'in stock' | 'out of stock';
  condition: 'new';
  price: number;
  currency: 'LKR';
  productUrl: string;
  imageUrl: string;
  brand: string;
  itemGroupId?: string;
  color?: string;
  size?: string;
};

function compactBrand(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function truncateCatalogText(value: string, maxLength: number): string {
  return Array.from(value.trim()).slice(0, maxLength).join('');
}

function validCatalogId(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || Array.from(trimmed).length > META_ID_MAX_LENGTH) return null;
  return trimmed;
}

function parentCatalogId(product: Pick<MetaCatalogFeedProduct, 'id' | 'sku'>): string {
  return validCatalogId(product.sku) ?? `PRODUCT-${product.id}`;
}

export function buildMetaCatalogVariantRetailerId(
  product: Pick<MetaCatalogFeedProduct, 'id' | 'sku'>,
  variant: { id: number; sku?: string | null },
): string {
  const variantSku = validCatalogId(variant.sku);
  if (variantSku && variantSku !== parentCatalogId(product)) return variantSku;

  const suffix = `-V${variant.id}`;
  const prefixLength = Math.max(1, META_ID_MAX_LENGTH - Array.from(suffix).length);
  return `${truncateCatalogText(parentCatalogId(product), prefixLength)}${suffix}`;
}

export function getMetaCatalogRetailerIds(product: MetaCatalogFeedProduct): string[] {
  const parentId = parentCatalogId(product);
  if (!product.variants?.length) return [parentId];

  // Include the parent ID so the first variant-aware sync removes any legacy
  // flattened item that earlier versions may have published.
  return Array.from(new Set([
    parentId,
    ...product.variants.map((variant) => buildMetaCatalogVariantRetailerId(product, variant)),
  ]));
}

export function getMetaCatalogBrand(value: string): MetaCatalogBrand | null {
  const compact = compactBrand(value);
  if (compact === 'happyby' || compact === 'happybuyfashion') return CATALOG_BRANDS.happybuy;
  if (compact === 'happybuy') return CATALOG_BRANDS.happybuy;
  if (compact === 'cleopatra') return CATALOG_BRANDS.cleopatra;
  if (compact === 'modabella') return CATALOG_BRANDS.modabella;
  return null;
}

export function slugifyCatalogProductName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCatalogProductUrl(
  brand: MetaCatalogBrand,
  product: Pick<MetaCatalogFeedProduct, 'id' | 'name'>,
): string {
  const nameSlug = slugifyCatalogProductName(product.name) || 'product';
  return `${brand.storefrontOrigin}/p/${nameSlug}-${product.id}`;
}

function cleanList(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildMetaCatalogDescription(product: MetaCatalogFeedProduct): string {
  const sentences = [product.name.trim()];
  if (product.style?.trim()) sentences.push(`Style: ${product.style.trim()}`);
  if (product.fabric?.trim()) sentences.push(`Fabric: ${product.fabric.trim()}`);
  if (product.fitType?.trim()) sentences.push(`Fit: ${product.fitType.trim()}`);

  const sizes = cleanList(product.sizes);
  const colors = cleanList(product.colors);
  if (sizes.length > 0) sentences.push(`Sizes: ${sizes.join(', ')}`);
  if (colors.length > 0) sentences.push(`Colors: ${colors.join(', ')}`);

  return sentences.map((sentence) => sentence.replace(/[.\s]+$/g, '')).join('. ') + '.';
}

function isActiveVariant(status?: string | null): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized !== 'archived' && normalized !== 'deleted';
}

export function getCatalogAvailableQuantity(product: MetaCatalogFeedProduct): number {
  const activeVariants = (product.variants ?? []).filter((variant) => isActiveVariant(variant.status));
  if (activeVariants.length > 0) {
    return activeVariants.reduce(
      (total, variant) => total + Math.max(0, variant.inventory?.availableQty ?? 0),
      0,
    );
  }

  return Math.max(0, product.inventory?.availableQty ?? product.stock ?? 0);
}

export function isPublicHttpsUrl(value?: string | null): value is string {
  if (!value?.trim()) return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

export function selectCatalogImageUrl(
  product: MetaCatalogFeedProduct,
  publicAssetOrigin?: string | null,
  preferredColor?: string | null,
): string | null {
  const normalizedColor = preferredColor?.trim().toLowerCase();
  const matchingColorImage = normalizedColor
    ? (product.colorImages ?? []).find(
        (image) => image.color?.trim().toLowerCase() === normalizedColor,
      )?.imageUrl
    : null;
  const directCandidates = [
    matchingColorImage,
    product.imageUrl,
    ...(product.colorImages ?? []).map((image) => image.imageUrl),
  ];

  for (const candidate of directCandidates) {
    if (isPublicHttpsUrl(candidate)) return candidate.trim();
  }

  const origin = publicAssetOrigin?.trim().replace(/\/+$/, '');
  const savedCreative = (product.creatives ?? []).find(
    (creative) => !creative.status || creative.status.trim().toLowerCase() === 'saved',
  );
  if (savedCreative) {
    // Blob-backed creatives are already on a public CDN.
    if (isPublicHttpsUrl(savedCreative.imageUrl)) return savedCreative.imageUrl!.trim();
    // Older rows serve from the app route, which Meta crawls without a session,
    // so the link carries its own signature.
    if (isPublicHttpsUrl(origin)) {
      return `${origin}${creativeImagePath(savedCreative.id, CATALOG_TTL_SECONDS)}`;
    }
  }

  return null;
}

export function mapProductToMetaCatalogRow(
  product: MetaCatalogFeedProduct,
  brand: MetaCatalogBrand,
  publicAssetOrigin?: string | null,
): MetaCatalogFeedRow | null {
  const catalogProduct = buildMetaCatalogProducts(product, brand, publicAssetOrigin)[0];
  if (!catalogProduct) return null;

  return mapMetaCatalogProductToRow(catalogProduct);
}

function mapMetaCatalogProductToRow(catalogProduct: MetaCatalogProduct): MetaCatalogFeedRow {
  return {
    id: catalogProduct.retailerId,
    title: catalogProduct.title,
    description: catalogProduct.description,
    availability: catalogProduct.availability,
    condition: catalogProduct.condition,
    price: `${catalogProduct.price.toFixed(2)} ${catalogProduct.currency}`,
    link: catalogProduct.productUrl,
    image_link: catalogProduct.imageUrl,
    brand: catalogProduct.brand,
    item_group_id: catalogProduct.itemGroupId ?? '',
    color: catalogProduct.color ?? '',
    size: catalogProduct.size ?? '',
  };
}

export function mapProductToMetaCatalogRows(
  product: MetaCatalogFeedProduct,
  brand: MetaCatalogBrand,
  publicAssetOrigin?: string | null,
): MetaCatalogFeedRow[] {
  return buildMetaCatalogProducts(product, brand, publicAssetOrigin).map(
    mapMetaCatalogProductToRow,
  );
}

export function buildMetaCatalogProduct(
  product: MetaCatalogFeedProduct,
  brand: MetaCatalogBrand,
  publicAssetOrigin?: string | null,
): MetaCatalogProduct | null {
  return buildMetaCatalogProducts(product, brand, publicAssetOrigin)[0] ?? null;
}

function catalogTitle(product: MetaCatalogFeedProduct): string {
  return truncateCatalogText(product.name, META_TITLE_MAX_LENGTH) || `Product ${product.id}`;
}

function catalogDescription(product: MetaCatalogFeedProduct): string {
  return truncateCatalogText(buildMetaCatalogDescription(product), META_DESCRIPTION_MAX_LENGTH)
    || `View ${catalogTitle(product)} details and availability.`;
}

function catalogBrandName(brand: MetaCatalogBrand): string {
  return truncateCatalogText(brand.platformName, META_BRAND_MAX_LENGTH);
}

export function buildMetaCatalogProducts(
  product: MetaCatalogFeedProduct,
  brand: MetaCatalogBrand,
  publicAssetOrigin?: string | null,
): MetaCatalogProduct[] {
  const status = product.status?.trim().toLowerCase();
  if (status === 'archived' || status === 'deleted') return [];

  const basePriceValid = Number.isFinite(product.price) && product.price >= 0;
  const common = {
    title: catalogTitle(product),
    description: catalogDescription(product),
    condition: 'new' as const,
    currency: 'LKR' as const,
    productUrl: buildCatalogProductUrl(brand, product),
    brand: catalogBrandName(brand),
  };

  if (product.variants?.length) {
    const itemGroupId = parentCatalogId(product);
    return product.variants.flatMap((variant) => {
      if (!isActiveVariant(variant.status)) return [];
      const price = Number.isFinite(variant.priceOverride)
        ? Number(variant.priceOverride)
        : product.price;
      const imageUrl = selectCatalogImageUrl(product, publicAssetOrigin, variant.color);
      if (!imageUrl || !Number.isFinite(price) || price < 0) return [];

      const retailerId = buildMetaCatalogVariantRetailerId(product, variant);
      const color = truncateCatalogText(
        variant.color?.trim() || 'Default',
        META_VARIANT_ATTRIBUTE_MAX_LENGTH,
      );
      const size = truncateCatalogText(
        variant.size?.trim() || 'One Size',
        META_VARIANT_ATTRIBUTE_MAX_LENGTH,
      );
      return [{
        ...common,
        sku: retailerId,
        retailerId,
        availability: (variant.inventory?.availableQty ?? 0) > 0
          ? 'in stock' as const
          : 'out of stock' as const,
        price,
        imageUrl,
        itemGroupId,
        color,
        size,
      }];
    });
  }

  const imageUrl = selectCatalogImageUrl(product, publicAssetOrigin);
  if (!imageUrl || !basePriceValid) return [];
  const retailerId = parentCatalogId(product);
  return [{
    ...common,
    sku: retailerId,
    retailerId,
    availability: getCatalogAvailableQuantity(product) > 0 ? 'in stock' : 'out of stock',
    price: product.price,
    imageUrl,
  }];
}

export function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildMetaCatalogCsv(rows: MetaCatalogFeedRow[]): string {
  const lines = [
    META_CATALOG_FEED_COLUMNS.join(','),
    ...rows.map((row) =>
      META_CATALOG_FEED_COLUMNS.map((column) => escapeCsvCell(row[column])).join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
