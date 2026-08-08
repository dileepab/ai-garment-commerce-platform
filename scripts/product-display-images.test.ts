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

// The Happybuy catalog bug: HAP-0002 and HAP-0003 had published creatives, yet
// the Meta feed served their phone photos. A colourway has one photo per angle,
// and pairing matched only whichever angle sorted first — so a creative
// generated from the colour's second photo was dropped as if it belonged to
// another colour.
test('a creative grounded in any angle of the colourway still counts', () => {
  const product = {
    imageUrl: '/products/fallback.jpg',
    colorImages: [
      { color: 'Cream Red Floral', imageUrl: '/products/cream-back.jpg' },
      { color: 'Cream Red Floral', imageUrl: '/products/cream-front.jpg' },
    ],
    creatives: [
      {
        id: 91,
        status: 'saved',
        publishedAt: new Date('2026-08-07T10:00:00Z'),
        viewAngle: 'front',
        // Generated from the colour's second photo, not the first.
        sourceImageUrl: '/products/cream-front.jpg',
        imageUrl: '/creatives/cream-front.jpg',
      },
    ],
  };

  const urls = productDisplayImageUrls(product, {
    resolveCreativeUrl: (creative) => creative.imageUrl,
    preferredColor: 'Cream Red Floral',
  });

  assert.deepEqual(urls, ['/creatives/cream-front.jpg']);
});

test('a creative from a different colourway is still excluded', () => {
  const product = {
    imageUrl: '/products/fallback.jpg',
    colorImages: [
      { color: 'Cream Red Floral', imageUrl: '/products/cream-front.jpg' },
      { color: 'Blue Grey', imageUrl: '/products/blue-front.jpg' },
    ],
    creatives: [
      {
        id: 92,
        status: 'saved',
        publishedAt: new Date('2026-08-07T10:00:00Z'),
        viewAngle: 'front',
        sourceImageUrl: '/products/blue-front.jpg',
        imageUrl: '/creatives/blue-front.jpg',
      },
    ],
  };

  const urls = productDisplayImageUrls(product, {
    resolveCreativeUrl: (creative) => creative.imageUrl,
    preferredColor: 'Cream Red Floral',
  });

  assert.deepEqual(urls, ['/products/cream-front.jpg'], 'expected the colour photo, not another colour');
});
