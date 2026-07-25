import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCatalogRecommendationReply,
  buildProductComparisonReply,
  buildUnavailableVariantReply,
  looksLikeRecommendationRequest,
  rankCatalogRecommendations,
  resolveRequestedVariant,
  type CatalogGuidanceProduct,
} from '../src/lib/chat/catalog-guidance.ts';

const products: CatalogGuidanceProduct[] = [
  {
    id: 1,
    name: 'Oversized Casual Top',
    style: 'Oversized Top',
    price: 1750,
    fabric: 'Cotton',
    sizes: 'S,M,L',
    colors: 'Black,White',
  },
  {
    id: 2,
    name: 'Ribbed Crop Top',
    style: 'Crop Top',
    price: 1250,
    fabric: 'Ribbed Cotton',
    sizes: 'S,M',
    colors: 'Beige,Pink',
    variants: [
      { size: 'S', color: 'Pink', status: 'active', inventory: { availableQty: 2 } },
      { size: 'M', color: 'Pink', status: 'active', inventory: { availableQty: 1 } },
      { size: 'S', color: 'Beige', status: 'active', inventory: { availableQty: 1 } },
      { size: 'M', color: 'Beige', status: 'active', inventory: { availableQty: 2 } },
    ],
  },
  {
    id: 3,
    name: 'Breezy Summer Dress',
    style: 'Summer Dress',
    price: 2950,
    fabric: 'Rayon',
    sizes: 'S,M,L',
    colors: 'Coral,Sage',
  },
  {
    id: 4,
    name: 'Relaxed Linen Pants',
    style: 'Relaxed Pants',
    price: 2400,
    fabric: 'Linen Blend',
    sizes: 'S,M,L',
    colors: 'Beige,Black',
  },
  {
    id: 5,
    name: 'Pleated Midi Skirt',
    style: 'Midi Skirt',
    price: 2100,
    fabric: 'Crepe',
    sizes: 'S,M,L',
    colors: 'Black,Cream',
  },
];

test('ranks a short, relevant hot-weather recommendation instead of the whole catalog', () => {
  const result = rankCatalogRecommendations(
    products,
    'I need something light and comfy for a hot day under Rs 3000.'
  );

  assert.deepEqual(
    result.products.map((product) => product.name),
    ['Breezy Summer Dress', 'Relaxed Linen Pants', 'Oversized Casual Top']
  );
  assert.equal(result.products.length, 3);
  assert.equal(result.exactMatch, true);

  const response = buildCatalogRecommendationReply(
    products,
    'I need something light and comfy for a hot day under Rs 3000.'
  );
  assert.match(response.reply, /Here are my best matches/);
  assert.match(response.reply, /My first pick would be Breezy Summer Dress/);
  assert.doesNotMatch(response.reply, /Ribbed Crop Top/);
  assert.doesNotMatch(response.reply, /Pleated Midi Skirt/);
});

test('treats stated budget and color as hard recommendation constraints', () => {
  assert.equal(
    looksLikeRecommendationRequest('Okay then, something casual under Rs 2000 in black.'),
    true
  );
  const result = rankCatalogRecommendations(
    products,
    'Show me something casual under Rs 2000 in black.'
  );

  assert.deepEqual(
    result.products.map((product) => product.name),
    ['Oversized Casual Top']
  );
  assert.equal(result.requestedBudget, 2000);
  assert.deepEqual(result.requestedColors, ['Black']);
});

test('compares two exact catalog products with grounded facts and a conclusion', () => {
  const comparison = buildProductComparisonReply(
    products,
    'Which is better for hot weather, the Breezy Summer Dress or the Relaxed Linen Pants?'
  );

  assert.ok(comparison);
  assert.match(comparison.reply, /Breezy Summer Dress — Rs 2950 · Rayon/);
  assert.match(comparison.reply, /Relaxed Linen Pants — Rs 2400 · Linen Blend/);
  assert.match(comparison.reply, /For hot weather/);
  assert.equal(comparison.preferredProduct.name, 'Breezy Summer Dress');
});

test('explicitly rejects an unavailable size and offers valid same-color alternatives', () => {
  const cropTop = products[1];
  const requested = resolveRequestedVariant(
    cropTop,
    'Do you have the Ribbed Crop Top in pink, size L?'
  );
  const reply = buildUnavailableVariantReply(cropTop, requested.size, requested.color);

  assert.equal(requested.size, 'L');
  assert.equal(requested.color, 'Pink');
  assert.ok(reply);
  assert.match(reply, /Pink, size L is not available right now/);
  assert.match(reply, /Pink is available in sizes S, M/);
});

test('allows an in-stock requested size and color combination', () => {
  const cropTop = products[1];
  const requested = resolveRequestedVariant(
    cropTop,
    'Is pink available in M size?'
  );

  assert.deepEqual(requested, { size: 'M', color: 'Pink' });
  assert.equal(
    buildUnavailableVariantReply(cropTop, requested.size, requested.color),
    null
  );
});
