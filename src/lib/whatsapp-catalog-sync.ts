import prisma from '@/lib/prisma';
import { resolveWhatsAppConfigForBrand } from '@/lib/brand-channel-config';
import {
  buildMetaCatalogProducts,
  getMetaCatalogRetailerIds,
  getMetaCatalogBrand,
  type MetaCatalogFeedProduct,
} from '@/lib/meta-catalog-feed';
import {
  buildCatalogDeleteRequest,
  buildCatalogUpsertRequest,
  emptyMetaCatalogBatchResult as emptySyncResult,
  submitMetaCatalogBatch as submitCatalogBatch,
  type CatalogBatchRequest,
  type MetaCatalogBatchResult,
} from '@/lib/meta-catalog-batch';
import { getPublicBaseUrl } from '@/lib/runtime-config';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const MAX_SAFE_ERROR_LENGTH = 500;
const META_REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = typeof fetch;

type MetaGraphError = {
  error?: {
    message?: string;
    code?: string | number;
    error_subcode?: string | number;
    type?: string;
  };
};

type MetaCatalogProfileResponse = MetaGraphError & {
  id?: string;
  name?: string;
};

type MetaCatalogsResponse = MetaGraphError & {
  data?: Array<{ id?: string; name?: string }>;
};

type MetaCommerceSettingsResponse = MetaGraphError & {
  data?: Array<{ is_cart_enabled?: boolean; is_catalog_visible?: boolean }>;
  is_cart_enabled?: boolean;
  is_catalog_visible?: boolean;
};

export interface WhatsAppCatalogConnectionResult {
  ok: boolean;
  brand: string;
  catalogId?: string;
  catalogName?: string;
  linkedToWaba: boolean;
  catalogVisible?: boolean;
  cartEnabled?: boolean;
  status?: number;
  error?: string;
}

export type WhatsAppCatalogSyncResult = MetaCatalogBatchResult;

export interface WhatsAppCatalogProductSyncResult extends WhatsAppCatalogSyncResult {
  attempted: boolean;
}

const catalogProductSelect = {
  id: true,
  sku: true,
  name: true,
  brand: true,
  style: true,
  price: true,
  fabric: true,
  sizes: true,
  colors: true,
  stock: true,
  status: true,
  imageUrl: true,
  fitType: true,
  inventory: { select: { availableQty: true } },
  variants: {
    select: {
      id: true,
      sku: true,
      size: true,
      color: true,
      priceOverride: true,
      status: true,
      inventory: { select: { availableQty: true } },
    },
    orderBy: { id: 'asc' as const },
  },
  colorImages: {
    select: { color: true, imageUrl: true },
    orderBy: { id: 'asc' as const },
  },
  creatives: {
    where: { status: 'saved' },
    select: { id: true, status: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
};

function graphUrl(objectId: string, edge?: string): string {
  const suffix = edge ? `/${edge}` : '';
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(objectId)}${suffix}`;
}

function maskId(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return 'redacted';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function safeMetaError(data: MetaGraphError, fallback: string, accessToken?: string): string {
  const code = data.error?.code ? `[${data.error.code}] ` : '';
  let message = `${code}${data.error?.message || fallback}`;
  if (accessToken) message = message.split(accessToken).join('[redacted]');
  message = message.replace(/access_token\s*[=:]\s*[^\s&,]+/gi, 'access_token=[redacted]');
  return message.slice(0, MAX_SAFE_ERROR_LENGTH);
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

function isRetiredProduct(product: Pick<MetaCatalogFeedProduct, 'status'>): boolean {
  const status = product.status?.trim().toLowerCase();
  return status === 'archived' || status === 'deleted';
}

function buildProductCatalogRequests(
  product: MetaCatalogFeedProduct,
  brand: NonNullable<ReturnType<typeof getMetaCatalogBrand>>,
  publicAssetOrigin: string | null,
): { requests: CatalogBatchRequest[]; skipped: number } {
  const catalogProducts = isRetiredProduct(product)
    ? []
    : buildMetaCatalogProducts(product, brand, publicAssetOrigin);
  const publishedIds = new Set(catalogProducts.map((item) => item.retailerId));
  const deletionRequests = getMetaCatalogRetailerIds(product)
    .filter((retailerId) => !publishedIds.has(retailerId))
    .map(buildCatalogDeleteRequest);

  return {
    requests: [
      ...deletionRequests,
      ...catalogProducts.map(buildCatalogUpsertRequest),
    ],
    skipped: !isRetiredProduct(product) && catalogProducts.length === 0 ? 1 : 0,
  };
}

export async function testWhatsAppCatalogConnection(
  brand: string,
  fetchImpl: FetchLike = fetch,
): Promise<WhatsAppCatalogConnectionResult> {
  const config = await resolveWhatsAppConfigForBrand(brand);
  if (!config?.businessAccountId || !config.catalogId) {
    return {
      ok: false,
      brand,
      linkedToWaba: false,
      error: 'Missing WhatsApp WABA ID, Catalog ID, Phone Number ID, or system-user token.',
    };
  }

  const catalogResponse = await fetchImpl(
    `${graphUrl(config.catalogId)}?fields=id,name`,
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    },
  );
  const catalogData = await readJson<MetaCatalogProfileResponse>(catalogResponse);
  if (!catalogResponse.ok || catalogData.id !== config.catalogId) {
    return {
      ok: false,
      brand,
      catalogId: maskId(config.catalogId),
      linkedToWaba: false,
      status: catalogResponse.status,
      error: safeMetaError(
        catalogData,
        `Meta Catalog returned ${catalogResponse.status}. Confirm catalog asset access and catalog_management permission.`,
        config.accessToken,
      ),
    };
  }

  const catalogsResponse = await fetchImpl(
    `${graphUrl(config.businessAccountId, 'product_catalogs')}?fields=id,name&limit=100`,
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    },
  );
  const catalogsData = await readJson<MetaCatalogsResponse>(catalogsResponse);
  if (!catalogsResponse.ok) {
    return {
      ok: false,
      brand,
      catalogId: maskId(config.catalogId),
      catalogName: catalogData.name,
      linkedToWaba: false,
      status: catalogsResponse.status,
      error: safeMetaError(catalogsData, `Meta WABA returned ${catalogsResponse.status}.`, config.accessToken),
    };
  }

  const linkedToWaba = (catalogsData.data ?? []).some((catalog) => catalog.id === config.catalogId);
  const commerceResponse = await fetchImpl(
    graphUrl(config.phoneNumberId, 'whatsapp_commerce_settings'),
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    },
  );
  const commerceData = await readJson<MetaCommerceSettingsResponse>(commerceResponse);
  const commerceSettings = commerceData.data?.[0] ?? commerceData;
  const catalogVisible = commerceSettings.is_catalog_visible;
  const cartEnabled = commerceSettings.is_cart_enabled;
  const ok = linkedToWaba && commerceResponse.ok && catalogVisible === true;

  return {
    ok,
    brand,
    catalogId: maskId(config.catalogId),
    catalogName: catalogData.name,
    linkedToWaba,
    catalogVisible,
    cartEnabled,
    status: commerceResponse.status,
    error: ok
      ? undefined
      : !linkedToWaba
        ? 'The configured catalog is accessible but is not connected to this WhatsApp Business Account.'
        : !commerceResponse.ok
          ? safeMetaError(commerceData, `Meta commerce settings returned ${commerceResponse.status}.`, config.accessToken)
          : 'The catalog is connected, but its WhatsApp storefront icon is turned off.',
  };
}

export async function syncWhatsAppCatalogForBrand(
  brandValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<WhatsAppCatalogSyncResult> {
  const brand = getMetaCatalogBrand(brandValue);
  if (!brand) {
    return {
      ...emptySyncResult(brandValue, false),
      ok: false,
      error: 'This brand does not have a configured public storefront catalog.',
    };
  }

  const config = await resolveWhatsAppConfigForBrand(brand.platformName);
  if (!config?.catalogId) {
    return {
      ...emptySyncResult(brand.platformName, false),
      ok: false,
      error: 'Missing WhatsApp Catalog ID, Phone Number ID, or system-user token.',
    };
  }

  const products = await prisma.product.findMany({
    where: {
      brand: { in: brand.databaseNames, mode: 'insensitive' },
    },
    select: catalogProductSelect,
    orderBy: { id: 'asc' },
  });
  const publicAssetOrigin = getPublicBaseUrl();
  const requests: CatalogBatchRequest[] = [];
  let skipped = 0;

  for (const product of products) {
    const mapped = buildProductCatalogRequests(product, brand, publicAssetOrigin);
    requests.push(...mapped.requests);
    skipped += mapped.skipped;
  }

  if (requests.length === 0) {
    return {
      ...emptySyncResult(brand.platformName, true),
      skipped,
    };
  }

  const result = await submitCatalogBatch({
    brand: brand.platformName,
    catalogId: config.catalogId,
    accessToken: config.accessToken,
    requests,
    fetchImpl,
  });
  result.skipped = skipped;
  return result;
}

export async function syncWhatsAppCatalogProduct(
  productId: number,
  fetchImpl: FetchLike = fetch,
): Promise<WhatsAppCatalogProductSyncResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: catalogProductSelect,
  });
  if (!product) {
    return {
      ...emptySyncResult('Unknown', false),
      ok: false,
      attempted: false,
      error: 'Product not found.',
    };
  }

  const brand = getMetaCatalogBrand(product.brand);
  if (!brand) {
    return {
      ...emptySyncResult(product.brand, false),
      attempted: false,
    };
  }

  const config = await resolveWhatsAppConfigForBrand(brand.platformName);
  if (!config?.catalogId) {
    return {
      ...emptySyncResult(brand.platformName, false),
      attempted: false,
    };
  }

  const mapped = buildProductCatalogRequests(product, brand, getPublicBaseUrl());
  if (mapped.requests.length === 0) {
    return {
      ...emptySyncResult(brand.platformName, true),
      attempted: false,
      skipped: mapped.skipped,
      ok: mapped.skipped === 0,
      error: mapped.skipped > 0
        ? 'The product has no valid catalog item. Add a public image and a non-negative price.'
        : undefined,
    };
  }

  const result = await submitCatalogBatch({
    brand: brand.platformName,
    catalogId: config.catalogId,
    accessToken: config.accessToken,
    requests: mapped.requests,
    fetchImpl,
  });
  result.skipped = mapped.skipped;
  return {
    ...result,
    attempted: true,
  };
}

export async function retireWhatsAppCatalogProduct(
  brandValue: string,
  retailerId: string | string[] | null | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<WhatsAppCatalogProductSyncResult> {
  const brand = getMetaCatalogBrand(brandValue);
  const retailerIds = Array.from(new Set(
    (Array.isArray(retailerId) ? retailerId : [retailerId])
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  ));
  if (!brand || retailerIds.length === 0) {
    return {
      ...emptySyncResult(brandValue, false),
      attempted: false,
    };
  }

  const config = await resolveWhatsAppConfigForBrand(brand.platformName);
  if (!config?.catalogId) {
    return {
      ...emptySyncResult(brand.platformName, false),
      attempted: false,
    };
  }

  return {
    ...(await submitCatalogBatch({
      brand: brand.platformName,
      catalogId: config.catalogId,
      accessToken: config.accessToken,
      requests: retailerIds.map(buildCatalogDeleteRequest),
      fetchImpl,
    })),
    attempted: true,
  };
}
