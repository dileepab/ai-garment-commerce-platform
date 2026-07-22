import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCatalogDeleteRequest,
  buildCatalogUpsertRequest,
  submitMetaCatalogBatch,
} from '../src/lib/meta-catalog-batch.ts';
import type { MetaCatalogProduct } from '../src/lib/meta-catalog-feed.ts';

function catalogProduct(overrides: Partial<MetaCatalogProduct> = {}): MetaCatalogProduct {
  return {
    sku: 'HB-0042',
    retailerId: 'HB-0042',
    title: 'Linen Day Dress',
    description: 'Linen day dress. Sizes: S, M, L.',
    availability: 'in stock',
    condition: 'new',
    price: 3490,
    currency: 'LKR',
    productUrl: 'https://happybuyfashion.com/p/linen-day-dress-42',
    imageUrl: 'https://cdn.example.com/products/linen-day-dress.jpg',
    brand: 'Happybuy',
    ...overrides,
  };
}

test('builds Meta items_batch upserts with feed-style LKR fields', () => {
  assert.deepEqual(buildCatalogUpsertRequest(catalogProduct()), {
    method: 'UPDATE',
    data: {
      id: 'HB-0042',
      title: 'Linen Day Dress',
      description: 'Linen day dress. Sizes: S, M, L.',
      availability: 'in stock',
      condition: 'new',
      brand: 'Happybuy',
      image_link: 'https://cdn.example.com/products/linen-day-dress.jpg',
      link: 'https://happybuyfashion.com/p/linen-day-dress-42',
      price: '3490 LKR',
    },
  });

  assert.deepEqual(buildCatalogDeleteRequest(' HB-0042 '), {
    method: 'DELETE',
    data: { id: 'HB-0042' },
  });
});

test('includes grouped garment variant fields in Meta batch upserts', () => {
  const request = buildCatalogUpsertRequest(catalogProduct({
    retailerId: 'HB-0042-BLU-S',
    sku: 'HB-0042-BLU-S',
    itemGroupId: 'HB-0042',
    color: 'Blue',
    size: 'S',
    price: 3690,
  }));

  assert.equal(request.method, 'UPDATE');
  assert.equal(request.data.item_group_id, 'HB-0042');
  assert.equal(request.data.color, 'Blue');
  assert.equal(request.data.size, 'S');
  assert.equal(request.data.price, '3690 LKR');
});

test('submits requests as Graph form parameters with the token only in Authorization', async () => {
  const accessToken = 'sensitive-system-user-token';
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const request = buildCatalogUpsertRequest(catalogProduct());

  const result = await submitMetaCatalogBatch({
    brand: 'Happybuy',
    catalogId: '3015545675306799',
    accessToken,
    graphVersion: 'v25.0',
    requests: [request],
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ handles: ['batch-handle-1'], validation_status: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.submitted, 1);
  assert.equal(result.upserted, 1);
  assert.deepEqual(result.handles, ['batch-handle-1']);
  assert.equal(requestUrl, 'https://graph.facebook.com/v25.0/3015545675306799/items_batch');
  assert.equal(requestUrl.includes(accessToken), false);
  assert.equal(new Headers(requestInit?.headers).get('Authorization'), `Bearer ${accessToken}`);
  assert.match(new Headers(requestInit?.headers).get('Content-Type') || '', /x-www-form-urlencoded/);

  const params = new URLSearchParams(String(requestInit?.body));
  assert.equal(params.get('item_type'), 'PRODUCT_ITEM');
  assert.equal(params.get('allow_upsert'), 'true');
  assert.deepEqual(JSON.parse(params.get('requests') || '[]'), [request]);
});

test('surfaces per-item validation errors and sanitizes Meta failures', async () => {
  const validationResult = await submitMetaCatalogBatch({
    brand: 'Happybuy',
    catalogId: '3015545675306799',
    accessToken: 'test-token',
    graphVersion: 'v25.0',
    requests: [buildCatalogUpsertRequest(catalogProduct())],
    fetchImpl: async () => new Response(JSON.stringify({
      handles: ['batch-handle-2'],
      validation_status: [{ retailer_id: 'HB-0042', errors: [{ message: 'Bad image' }] }],
    }), { status: 200 }),
  });
  assert.equal(validationResult.ok, false);
  assert.equal(validationResult.validationErrors, 1);
  assert.match(validationResult.error || '', /failed Meta validation/);

  const accessToken = 'never-show-this-token';
  const failure = await submitMetaCatalogBatch({
    brand: 'Happybuy',
    catalogId: '3015545675306799',
    accessToken,
    graphVersion: 'v25.0',
    requests: [buildCatalogUpsertRequest(catalogProduct())],
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: 200, message: `Token ${accessToken} lacks catalog_management` },
    }), { status: 403 }),
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.status, 403);
  assert.equal(failure.error?.includes(accessToken), false);
  assert.match(failure.error || '', /catalog_management/);
});

test('chunks large catalog changes and validates Meta identifiers', async () => {
  let calls = 0;
  const requests = Array.from({ length: 1001 }, (_, index) =>
    buildCatalogDeleteRequest(`HB-${String(index + 1).padStart(4, '0')}`));
  const result = await submitMetaCatalogBatch({
    brand: 'Happybuy',
    catalogId: '3015545675306799',
    accessToken: 'test-token',
    graphVersion: 'v25.0',
    requests,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ handles: [`handle-${calls}`] }), { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.submitted, 1001);
  assert.equal(result.deleted, 1001);

  await assert.rejects(
    submitMetaCatalogBatch({
      brand: 'Happybuy',
      catalogId: 'catalog-id',
      accessToken: 'test-token',
      graphVersion: 'v25.0',
      requests: [],
    }),
    /digits only/,
  );
  await assert.rejects(
    submitMetaCatalogBatch({
      brand: 'Happybuy',
      catalogId: '3015545675306799',
      accessToken: 'test-token',
      graphVersion: 'latest',
      requests: [],
    }),
    /Graph version is invalid/,
  );
});
