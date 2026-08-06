import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compactItemCode,
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

test('codes are extracted from a message with several of them', () => {
  const codes = extractItemCodes('Can I get HAP-0002 and hap 0003?');

  assert.deepEqual(codes, ['hap0002', 'hap0003']);
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
