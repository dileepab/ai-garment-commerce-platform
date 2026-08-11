import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMultiCodeReply } from '../src/lib/chat/multi-code-reply.ts';

const SUNDRESS = {
  name: 'Tie-Strap Smocked Sundress — Blue Grey',
  itemCode: 'HAP-0001',
  price: 1990,
  sizes: 'S,M,L,XL',
  availableQty: 12,
};

const CREAM = {
  name: 'Tie-Strap Smocked Sundress — Cream Red Floral',
  itemCode: 'HAP-0002',
  price: 1990,
  sizes: 'L,M,S,XL',
  availableQty: 4,
};

const RED = {
  name: 'Tie-Strap Smocked Sundress — Red Floral',
  itemCode: 'HAP-0003',
  price: 2490,
  sizes: 'S,M',
  availableQty: 7,
};

/**
 * The defect this exists for: tapping a three-dress carousel prefills
 * "Details HAP-0001 HAP-0002 HAP-0003", and the router answered about the
 * first dress only. The shopper had to ask again for items they had already
 * pointed at.
 */
test('every item the customer named is answered', () => {
  const reply = buildMultiCodeReply([SUNDRESS, CREAM, RED]);

  assert.match(reply, /HAP-0001/);
  assert.match(reply, /HAP-0002/);
  assert.match(reply, /HAP-0003/);
  assert.match(reply, /Which one would you like\?$/);
});

test('each line carries what is needed to choose', () => {
  const reply = buildMultiCodeReply([SUNDRESS, RED]);

  assert.match(reply, /Tie-Strap Smocked Sundress — Blue Grey \(HAP-0001\) — Rs 1,990 — Sizes: S, M, L, XL/);
  assert.match(reply, /Tie-Strap Smocked Sundress — Red Floral \(HAP-0003\) — Rs 2,490 — Sizes: S, M/);
});

// Sizes are typed by hand, so the stored order means nothing.
test('sizes are ordered smallest to largest', () => {
  assert.match(buildMultiCodeReply([CREAM]), /Sizes: S, M, L, XL/);
});

// Silence on one of three reads as us ignoring it.
test('a sold-out item is named rather than dropped', () => {
  const reply = buildMultiCodeReply([SUNDRESS, { ...CREAM, availableQty: 0 }]);

  assert.match(reply, /HAP-0002/);
  assert.match(reply, /Cream Red Floral \(HAP-0002\) — Sold out/);
  // No price or sizes offered for something that cannot be bought.
  assert.doesNotMatch(reply, /HAP-0002\) — Rs/);
  assert.match(reply, /Which one would you like\?$/);
});

test('nothing in stock changes what we ask for', () => {
  const reply = buildMultiCodeReply([
    { ...SUNDRESS, availableQty: 0 },
    { ...CREAM, availableQty: 0 },
  ]);

  assert.doesNotMatch(reply, /Which one would you like/);
  assert.match(reply, /back in stock\?$/);
});

// Stock is not always known; an unknown count must not read as sold out.
test('unknown stock is still offered', () => {
  const reply = buildMultiCodeReply([{ ...SUNDRESS, availableQty: null }]);

  assert.doesNotMatch(reply, /Sold out/);
  assert.match(reply, /Rs 1,990/);
});

// Dropping it would be the very bug this module exists to fix.
test('a product with no code is still listed', () => {
  const reply = buildMultiCodeReply([{ ...SUNDRESS, itemCode: null }, RED]);

  assert.match(reply, /Tie-Strap Smocked Sundress — Blue Grey — Rs 1,990/);
  assert.match(reply, /HAP-0003/);
});

test('a product with no size list still gets a line', () => {
  const reply = buildMultiCodeReply([{ ...SUNDRESS, sizes: null }]);

  assert.match(reply, /Blue Grey \(HAP-0001\) — Rs 1,990$/m);
  assert.doesNotMatch(reply, /Sizes:/);
});
