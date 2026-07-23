import type { MetaCatalogProduct } from './meta-catalog-feed.ts';

const DEFAULT_META_GRAPH_VERSION = 'v22.0';
const MAX_BATCH_SIZE = 1000;
const MAX_SAFE_ERROR_LENGTH = 500;
const META_REQUEST_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

type MetaGraphError = {
  error?: {
    message?: string;
    code?: string | number;
  };
};

type MetaBatchResponse = MetaGraphError & {
  handles?: string[];
  validation_status?: Array<{
    retailer_id?: string;
    errors?: unknown[];
    warnings?: unknown[];
  }>;
};

export type CatalogBatchUpsertRequest = {
  method: 'UPDATE';
  data: {
    id: string;
    title: string;
    description: string;
    availability: MetaCatalogProduct['availability'];
    condition: MetaCatalogProduct['condition'];
    brand: string;
    image_link: string;
    link: string;
    price: string;
    item_group_id?: string;
    color?: string;
    size?: string;
  };
};

export type CatalogBatchRequest =
  | CatalogBatchUpsertRequest
  | {
      method: 'DELETE';
      data: { id: string };
    };

export interface MetaCatalogBatchResult {
  ok: boolean;
  brand: string;
  configured: boolean;
  submitted: number;
  upserted: number;
  deleted: number;
  skipped: number;
  validationErrors: number;
  handles: string[];
  status?: number;
  error?: string;
}

function buildGraphUrl(catalogId: string, graphVersion: string): string {
  if (!/^\d+$/.test(catalogId)) {
    throw new Error('Meta Catalog ID must contain digits only.');
  }
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error('Meta Graph version is invalid.');
  }
  return `https://graph.facebook.com/${graphVersion}/${catalogId}/items_batch`;
}

function safeMetaError(data: MetaGraphError, fallback: string, accessToken: string): string {
  const code = data.error?.code ? `[${data.error.code}] ` : '';
  let message = `${code}${data.error?.message || fallback}`;
  message = message.split(accessToken).join('[redacted]');
  message = message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  message = message.replace(/access_token\s*[=:]\s*[^\s&,]+/gi, 'access_token=[redacted]');
  return message.slice(0, MAX_SAFE_ERROR_LENGTH);
}

async function readJson(response: Response): Promise<MetaBatchResponse> {
  try {
    return await response.json() as MetaBatchResponse;
  } catch {
    return {};
  }
}

function normalizedPrice(product: MetaCatalogProduct): string {
  const amount = Number.isInteger(product.price)
    ? String(product.price)
    : product.price.toFixed(2).replace(/\.00$/, '');
  return `${amount} ${product.currency}`;
}

export function buildCatalogUpsertRequest(product: MetaCatalogProduct): CatalogBatchUpsertRequest {
  const variantFields = product.itemGroupId
    ? {
        item_group_id: product.itemGroupId,
        ...(product.color ? { color: product.color } : {}),
        ...(product.size ? { size: product.size } : {}),
      }
    : {};

  return {
    method: 'UPDATE',
    data: {
      id: product.retailerId,
      title: product.title,
      description: product.description,
      availability: product.availability,
      condition: product.condition,
      brand: product.brand,
      image_link: product.imageUrl,
      link: product.productUrl,
      price: normalizedPrice(product),
      ...variantFields,
    },
  };
}

export function buildCatalogDeleteRequest(retailerId: string): CatalogBatchRequest {
  return {
    method: 'DELETE',
    data: { id: retailerId.trim() },
  };
}

export function emptyMetaCatalogBatchResult(
  brand: string,
  configured: boolean,
): MetaCatalogBatchResult {
  return {
    ok: configured,
    brand,
    configured,
    submitted: 0,
    upserted: 0,
    deleted: 0,
    skipped: 0,
    validationErrors: 0,
    handles: [],
  };
}

export async function submitMetaCatalogBatch(params: {
  brand: string;
  catalogId: string;
  accessToken: string;
  requests: CatalogBatchRequest[];
  graphVersion?: string;
  fetchImpl?: FetchLike;
}): Promise<MetaCatalogBatchResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const graphVersion = params.graphVersion ?? process.env.META_GRAPH_VERSION ?? DEFAULT_META_GRAPH_VERSION;
  const aggregate = emptyMetaCatalogBatchResult(params.brand, true);
  const url = buildGraphUrl(params.catalogId, graphVersion);

  for (let offset = 0; offset < params.requests.length; offset += MAX_BATCH_SIZE) {
    const chunk = params.requests.slice(offset, offset + MAX_BATCH_SIZE);
    const body = new URLSearchParams({
      item_type: 'PRODUCT_ITEM',
      allow_upsert: 'true',
      requests: JSON.stringify(chunk),
    });
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body,
        signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      aggregate.ok = false;
      aggregate.error = safeMetaError(
        {},
        error instanceof Error ? error.message : 'Could not reach Meta Graph.',
        params.accessToken,
      );
      break;
    }

    const data = await readJson(response);
    aggregate.status = response.status;
    aggregate.submitted += chunk.length;
    aggregate.upserted += chunk.filter((request) => request.method === 'UPDATE').length;
    aggregate.deleted += chunk.filter((request) => request.method === 'DELETE').length;
    aggregate.handles.push(...(data.handles ?? []));
    aggregate.validationErrors += (data.validation_status ?? []).filter(
      (entry) => Array.isArray(entry.errors) && entry.errors.length > 0,
    ).length;

    if (!response.ok) {
      aggregate.ok = false;
      aggregate.error = safeMetaError(
        data,
        `Meta Catalog returned ${response.status}.`,
        params.accessToken,
      );
      break;
    }
  }

  if (aggregate.validationErrors > 0) {
    aggregate.ok = false;
    aggregate.error = `${aggregate.validationErrors} catalog item${aggregate.validationErrors === 1 ? '' : 's'} failed Meta validation.`;
  }

  return aggregate;
}
