import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  colorPhotoUrl,
  productDisplayImageUrls,
  rankDisplayCreatives,
} from '../src/lib/product-display-images.ts';

const CREAM_PHOTO = 'https://blob.example/cream-front.jpg';
const BLUE_PHOTO = 'https://blob.example/blue-front.jpg';

const resolveCreativeUrl = (creative: { id: number; imageUrl?: string | null }) =>
  creative.imageUrl ?? `/api/content/creatives/${creative.id}/image`;

function product(creatives: Array<Record<string, unknown>>) {
  return {
    imageUrl: 'https://blob.example/product.jpg',
    colorImages: [
      { color: 'Cream Red Floral', imageUrl: CREAM_PHOTO },
      { color: 'Blue Grey', imageUrl: BLUE_PHOTO },
    ],
    creatives: creatives as never,
  };
}

test('a published creative outranks a merely saved one', () => {
  const ranked = rankDisplayCreatives(
    product([
      { id: 1, status: 'saved', viewAngle: 'front', createdAt: '2026-08-06T00:00:00Z' },
      { id: 2, status: 'saved', viewAngle: 'front', publishedAt: '2026-08-01T00:00:00Z' },
    ])
  );

  assert.equal(ranked[0].id, 2);
});

test('angle order decides between two published creatives', () => {
  const ranked = rankDisplayCreatives(
    product([
      { id: 1, status: 'saved', viewAngle: 'back', publishedAt: '2026-08-06T00:00:00Z' },
      { id: 2, status: 'saved', viewAngle: 'front', publishedAt: '2026-08-01T00:00:00Z' },
    ])
  );

  assert.deepEqual(ranked.map((c) => c.id), [2, 1]);
});

test('the most recently published wins at the same angle', () => {
  const ranked = rankDisplayCreatives(
    product([
      { id: 1, status: 'saved', viewAngle: 'front', publishedAt: '2026-08-01T00:00:00Z' },
      { id: 2, status: 'saved', viewAngle: 'front', publishedAt: '2026-08-06T00:00:00Z' },
    ])
  );

  assert.equal(ranked[0].id, 2);
});

// Showing the wrong colourway is worse than showing the original photo, so a
// creative generated from another colour's photo is dropped, not reordered.
test('creatives from another colourway are excluded, not just deprioritised', () => {
  const ranked = rankDisplayCreatives(
    product([
      { id: 1, status: 'saved', viewAngle: 'front', sourceImageUrl: BLUE_PHOTO, publishedAt: '2026-08-06T00:00:00Z' },
      { id: 2, status: 'saved', viewAngle: 'front', sourceImageUrl: CREAM_PHOTO },
    ]),
    'Cream Red Floral'
  );

  assert.deepEqual(ranked.map((c) => c.id), [2]);
});

test('draft creatives never surface to customers', () => {
  const ranked = rankDisplayCreatives(
    product([{ id: 1, status: 'draft', viewAngle: 'front', publishedAt: '2026-08-06T00:00:00Z' }])
  );

  assert.deepEqual(ranked, []);
});

test('a published creative is used instead of the colour photo', () => {
  const urls = productDisplayImageUrls(
    product([
      {
        id: 9,
        status: 'saved',
        viewAngle: 'front',
        sourceImageUrl: CREAM_PHOTO,
        imageUrl: 'https://blob.example/creative-9.jpg',
        publishedAt: '2026-08-06T00:00:00Z',
      },
    ]),
    { resolveCreativeUrl, preferredColor: 'Cream Red Floral' }
  );

  assert.deepEqual(urls, ['https://blob.example/creative-9.jpg']);
});

test('the colour photo is the fallback when no creative exists', () => {
  const urls = productDisplayImageUrls(product([]), {
    resolveCreativeUrl,
    preferredColor: 'Cream Red Floral',
  });

  assert.deepEqual(urls, [CREAM_PHOTO]);
});

test('the product photo is the last resort', () => {
  const urls = productDisplayImageUrls(
    { imageUrl: 'https://blob.example/product.jpg', colorImages: [], creatives: [] },
    { resolveCreativeUrl }
  );

  assert.deepEqual(urls, ['https://blob.example/product.jpg']);
});

test('a product with nothing at all yields no images', () => {
  assert.deepEqual(productDisplayImageUrls({}, { resolveCreativeUrl }), []);
});

test('creatives that resolve to no url fall through to the photo', () => {
  const urls = productDisplayImageUrls(
    product([{ id: 5, status: 'saved', viewAngle: 'front', sourceImageUrl: CREAM_PHOTO }]),
    { resolveCreativeUrl: () => null, preferredColor: 'Cream Red Floral' }
  );

  assert.deepEqual(urls, [CREAM_PHOTO]);
});

test('the limit caps how many images come back', () => {
  const urls = productDisplayImageUrls(
    product([
      { id: 1, status: 'saved', viewAngle: 'front', imageUrl: 'a' },
      { id: 2, status: 'saved', viewAngle: 'side', imageUrl: 'b' },
      { id: 3, status: 'saved', viewAngle: 'back', imageUrl: 'c' },
    ]),
    { resolveCreativeUrl, limit: 2 }
  );

  assert.deepEqual(urls, ['a', 'b']);
});

test('colour photo lookup is case and whitespace tolerant', () => {
  assert.equal(colorPhotoUrl(product([]), '  cream red floral '), CREAM_PHOTO);
  assert.equal(colorPhotoUrl(product([]), 'Nonexistent'), undefined);
});
