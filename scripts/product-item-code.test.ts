import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compactItemCode,
  normalizeItemCode,
  extractItemCodes,
  messageMentionsItemCode,
  productItemCode,
} from '../src/lib/product-item-code.ts';
import { findMentionedCatalogProducts } from '../src/lib/chat/catalog-guidance.ts';

const HAP_0002 = { id: 2, brand: 'Happybuy', sku: 'HAP-0002' };

test('a stored sku is used verbatim', () => {
  assert.equal(productItemCode(HAP_0002), 'HAP-0002');
});

test('a legacy product without a stored sku derives the admin code', () => {
  assert.equal(productItemCode({ id: 7, brand: 'Happybuy' }), 'HAP-0007');
});

test('no code is invented when there is nothing to derive one from', () => {
  assert.equal(productItemCode({ id: 7 }), null);
  assert.equal(productItemCode({ brand: 'Happybuy' }), null);
  assert.equal(productItemCode({}), null);
});

// Customers retype codes by hand, so separators and case must not matter.
test('hand-typed spellings of a code all match', () => {
  for (const spelling of [
    'HAP-0002',
    'hap-0002',
    'HAP0002',
    'hap 0002',
    'hap_0002',
    '#HAP-0002',
    'do you have HAP-0002 in medium?',
    'I want the hap 0002 one please',
  ]) {
    assert.equal(
      messageMentionsItemCode(spelling, HAP_0002),
      true,
      `expected "${spelling}" to match HAP-0002`
    );
  }
});

test('a different product code does not match', () => {
  assert.equal(messageMentionsItemCode('HAP-0001', HAP_0002), false);
  assert.equal(messageMentionsItemCode('CLE-0002', HAP_0002), false);
});

// A bare number would collide with sizes, quantities and phone digits.
test('bare numbers are never treated as item codes', () => {
  assert.equal(messageMentionsItemCode('0002', HAP_0002), false);
  assert.equal(messageMentionsItemCode('I want 2 of them', HAP_0002), false);
  assert.equal(messageMentionsItemCode('my number is 0771234567', HAP_0002), false);
});

test('a code embedded in a longer word does not match', () => {
  assert.equal(messageMentionsItemCode('whap0002', HAP_0002), false);
  assert.equal(messageMentionsItemCode('cheap 0002 dresses', HAP_0002), false);
});

// Extraction returns the comparison form, which ignores zero padding.
test('codes are extracted from a message with several of them', () => {
  const codes = extractItemCodes('Can I get HAP-0002 and hap 0003?');

  assert.deepEqual(codes, ['hap2', 'hap3']);
});

test('compacting strips separators and case', () => {
  assert.equal(compactItemCode('HAP-0002'), 'hap0002');
  assert.equal(compactItemCode('hap 0002'), 'hap0002');
});

// The colourways of one design differ by a word or two, which is exactly where
// name matching is weakest and a code should win.
const CATALOG = [
  {
    id: 1,
    brand: 'Happybuy',
    sku: 'HAP-0001',
    name: 'Tie-Strap Smocked Sundress — Blue Grey',
    price: 3500,
    sizes: 'S,M',
    colors: 'Blue Grey',
  },
  {
    id: 2,
    brand: 'Happybuy',
    sku: 'HAP-0002',
    name: 'Tie-Strap Smocked Sundress — Cream Red Floral',
    price: 3500,
    sizes: 'S,M',
    colors: 'Cream Red Floral',
  },
];

test('a quoted item code selects exactly one colourway', () => {
  const matched = findMentionedCatalogProducts('do you have HAP-0002?', CATALOG);

  assert.equal(matched.length, 1);
  assert.equal(matched[0].sku, 'HAP-0002');
});

test('a code beats the name when both could match', () => {
  const matched = findMentionedCatalogProducts(
    'the Tie-Strap Smocked Sundress, HAP-0002 please',
    CATALOG
  );

  assert.equal(matched.length, 1);
  assert.equal(matched[0].sku, 'HAP-0002');
});

test('name matching still works when no code is quoted', () => {
  const matched = findMentionedCatalogProducts(
    'Tie-Strap Smocked Sundress — Blue Grey please',
    CATALOG
  );

  assert.equal(matched.length, 1);
  assert.equal(matched[0].sku, 'HAP-0001');
});

/**
 * A real conversation: the customer asked "Hap-005 available?" about HAP-0005.
 * One zero short, so nothing matched — and with no product pinned the reply
 * fell back to the product discussed earlier, answering about HAP-0004 instead.
 */
test('a dropped zero still finds the product', () => {
  const HAP_0005 = { id: 9, brand: 'Happybuy', sku: 'HAP-0005' };

  assert.equal(messageMentionsItemCode('Hap-005 available?', HAP_0005), true);
  assert.equal(messageMentionsItemCode('HAP-0005 available?', HAP_0005), true);
  assert.equal(messageMentionsItemCode('#hap005', HAP_0005), true);
});

// Padding is presentation only, so it must not let one product answer for another.
test('dropping padding does not make two products collide', () => {
  const HAP_0005 = { id: 9, brand: 'Happybuy', sku: 'HAP-0005' };
  const HAP_0050 = { id: 50, brand: 'Happybuy', sku: 'HAP-0050' };

  assert.equal(messageMentionsItemCode('Hap-005', HAP_0050), false);
  assert.equal(messageMentionsItemCode('Hap-050', HAP_0005), false);
  assert.equal(messageMentionsItemCode('Hap-050', HAP_0050), true);
});

/**
 * A single digit is still not a code. "size 4" and "age 8" are the shape the
 * pattern would otherwise match, and a false code changes how a message routes.
 */
test('one digit is not treated as an item code', () => {
  const HAP_0005 = { id: 9, brand: 'Happybuy', sku: 'HAP-0005' };

  assert.equal(messageMentionsItemCode('hap 5 available?', HAP_0005), false);
  assert.deepEqual(extractItemCodes('size 4 please'), []);
});

test('normalizing strips separators, case and padding', () => {
  assert.equal(normalizeItemCode('HAP-0005'), 'hap5');
  assert.equal(normalizeItemCode('hap 005'), 'hap5');
  assert.equal(normalizeItemCode('#HAP5'), 'hap5');
  // All zeros must not normalize to an empty number.
  assert.equal(normalizeItemCode('HAP-0000'), 'hap0');
});

/**
 * The live Happybuy catalog, which is the shape that produced the bug report:
 * two colourways of one design, sitting next to each other, their codes one
 * digit apart. Every way a customer writes the navy skort's code must reach the
 * navy skort and nothing else — a near miss here answers about the brown one.
 */
test('each code in a real catalog matches exactly one product', () => {
  const catalog = [
    { id: 5, brand: 'Happybuy', sku: 'HAP-0001' },
    { id: 6, brand: 'Happybuy', sku: 'HAP-0002' },
    { id: 7, brand: 'Happybuy', sku: 'HAP-0003' },
    { id: 8, brand: 'Happybuy', sku: 'HAP-0004' },
    { id: 9, brand: 'Happybuy', sku: 'HAP-0005' },
  ];

  const matches = (message: string) =>
    catalog.filter((product) => messageMentionsItemCode(message, product)).map((p) => p.sku);

  for (const message of [
    'Is HAP-0005 available?',
    'Hap-005 available?',
    'HAP-0005',
    'I want Photo of HAP-0005',
    'hap0005 tiyenawada?',
  ]) {
    assert.deepEqual(matches(message), ['HAP-0005'], message);
  }

  assert.deepEqual(matches('HAP-0004 price?'), ['HAP-0004']);
});

/**
 * Product ids and SKU numbers are separate sequences — HAP-0001 is row 5 — so a
 * code derived from the id lands on a different product's SKU. Stored SKUs are
 * what keep those apart, and every catalog row has one.
 */
test('a stored SKU is preferred over one derived from the row id', () => {
  assert.equal(productItemCode({ id: 5, brand: 'Happybuy', sku: 'HAP-0001' }), 'HAP-0001');
  assert.equal(productItemCode({ id: 5, brand: 'Happybuy', sku: null }), 'HAP-0005');
});
