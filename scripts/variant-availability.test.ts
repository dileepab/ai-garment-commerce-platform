import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isVariantAvailable,
  variantAvailableQty,
} from '../src/lib/variant-availability.ts';
import { buildUnavailableVariantReply } from '../src/lib/chat/catalog-guidance.ts';

// The bug this guards: a variant created empty is stored as "out-of-stock", the
// product form resubmits that value verbatim on later saves, and the shop bot
// then told customers the item was unavailable while the product page showed
// stock on hand.
test('a variant holding stock is available despite a stale out-of-stock status', () => {
  assert.equal(
    isVariantAvailable({ status: 'out-of-stock', inventory: { availableQty: 20 } }),
    true
  );
});

test('a genuinely empty variant is unavailable', () => {
  assert.equal(
    isVariantAvailable({ status: 'active', inventory: { availableQty: 0 } }),
    false
  );
});

test('a retired variant stays unavailable because retiring zeroes its quantity', () => {
  assert.equal(
    isVariantAvailable({ status: 'out-of-stock', inventory: { availableQty: 0 } }),
    false
  );
});

test('a variant with no inventory row is unavailable', () => {
  assert.equal(isVariantAvailable({ status: 'active', inventory: null }), false);
  assert.equal(isVariantAvailable({}), false);
});

test('negative quantities never count as available stock', () => {
  assert.equal(variantAvailableQty({ inventory: { availableQty: -5 } }), 0);
  assert.equal(isVariantAvailable({ inventory: { availableQty: -5 } }), false);
});

test('stocked variants with stale statuses are not reported as out of stock', () => {
  const product = {
    id: 1,
    name: 'Tie-Strap Smocked Sundress — Cream Red Floral',
    price: 3500,
    sizes: 'S,M,L,XL',
    colors: 'Cream Red Floral',
    variants: ['S', 'M', 'L', 'XL'].map((size) => ({
      size,
      color: 'Cream Red Floral',
      status: 'out-of-stock',
      inventory: { availableQty: 5 },
    })),
  };

  const reply = buildUnavailableVariantReply(product, null, 'Cream Red Floral');

  assert.equal(reply, null, 'expected no unavailable reply for a stocked colourway');
});

test('a colourway with no stock is still reported as unavailable', () => {
  const product = {
    id: 2,
    name: 'Tie-Strap Smocked Sundress',
    price: 3500,
    sizes: 'S,M',
    colors: 'Cream Red Floral,Blue Grey',
    variants: [
      { size: 'S', color: 'Cream Red Floral', status: 'active', inventory: { availableQty: 0 } },
      { size: 'M', color: 'Blue Grey', status: 'active', inventory: { availableQty: 4 } },
    ],
  };

  const reply = buildUnavailableVariantReply(product, null, 'Cream Red Floral');

  assert.ok(reply, 'expected an unavailable reply for a sold-out colourway');
  assert.match(reply, /not available right now/);
});
