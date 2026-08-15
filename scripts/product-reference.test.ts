import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canFallBackToConversationProduct,
  isReferentialProductMention,
} from '../src/lib/chat/product-reference.ts';

const SUNDRESS = { id: 2, name: 'Tie-Strap Smocked Sundress — Cream Red Floral' };

/**
 * The live conversation this exists for. The bot had just named the item and
 * quoted its fabric; she asked what this dress is made of and was asked which
 * item she meant.
 */
test('a Sinhala demonstrative refers to the item under discussion', () => {
  assert.equal(isReferentialProductMention('මේ ගවුම'), true);
  assert.equal(isReferentialProductMention('ගවුම'), true);
  assert.equal(
    canFallBackToConversationProduct({
      extractedProductName: 'මේ ගවුම',
      matchedProduct: null,
    }),
    true
  );
});

test('English and Singlish demonstratives do the same', () => {
  for (const phrase of ['this dress', 'this item', 'meka', 'me gawma', 'the one', 'it']) {
    assert.equal(isReferentialProductMention(phrase), true, `${phrase} should be referential`);
  }
});

/**
 * The guard that keeps this safe. Falling back on *any* unmatched name would
 * answer a question about kurtas with the details of the last dress discussed —
 * confidently, and wrongly. Asking is better than guessing.
 */
test('a name that identifies something is never overridden by memory', () => {
  for (const phrase of ['kurta', 'this kurta', 'denim jacket', 'saree', 'HAP-0007']) {
    assert.equal(isReferentialProductMention(phrase), false, `${phrase} should not be referential`);
    assert.equal(
      canFallBackToConversationProduct({ extractedProductName: phrase, matchedProduct: null }),
      false,
      `${phrase} should not fall back`
    );
  }
});

// Extracting nothing has always used the remembered product; that is unchanged.
test('an empty extraction still uses the remembered product', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(
      canFallBackToConversationProduct({ extractedProductName: value, matchedProduct: null }),
      true
    );
  }
});

test('a real match wins over conversation memory', () => {
  assert.equal(
    canFallBackToConversationProduct({
      extractedProductName: 'Tie-Strap Smocked Sundress',
      matchedProduct: SUNDRESS,
    }),
    false
  );
  // Even a referential phrase defers to something the catalog actually matched.
  assert.equal(
    canFallBackToConversationProduct({ extractedProductName: 'this dress', matchedProduct: SUNDRESS }),
    false
  );
});

test('punctuation and casing do not defeat the match', () => {
  assert.equal(isReferentialProductMention('This Dress.'), true);
  assert.equal(isReferentialProductMention('"the item"'), true);
});

// Every word must be referential — one informative word means she is naming
// something else, and the mixed case is the one most likely to mislead.
test('a mixed phrase is treated as naming something else', () => {
  assert.equal(isReferentialProductMention('this red kurta'), false);
  assert.equal(isReferentialProductMention('ගවුම kurta'), false);
});

/**
 * A customer asked "Hap-005 available?" about HAP-0005. The code was one zero
 * short, matched nothing, and the reply fell back to the product discussed
 * earlier — telling them HAP-0004 was in stock. Naming a code is the most
 * specific thing a customer can do; failing to find it must not become a
 * confident answer about something else.
 */
test('an unknown item code blocks the remembered product', () => {
  assert.equal(
    canFallBackToConversationProduct({
      extractedProductName: null,
      matchedProduct: null,
      quotedUnknownItemCode: true,
    }),
    false,
  );
});

test('a referential mention still falls back when no code was quoted', () => {
  assert.equal(
    canFallBackToConversationProduct({
      extractedProductName: 'this dress',
      matchedProduct: null,
      quotedUnknownItemCode: false,
    }),
    true,
  );
});
