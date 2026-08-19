import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAdArrivalReply,
  resolveProductFromAdReferral,
} from '../src/lib/chat/ad-referral-product.ts';

const CATALOG = [
  { id: 1, name: 'Tie-Strap Smocked Sundress — Blue Grey', itemCode: 'HAP-0001' },
  { id: 2, name: 'Tie-Strap Smocked Sundress — Cream Red Floral', itemCode: 'HAP-0002' },
  { id: 3, name: 'Tie-Strap Smocked Sundress — Red Floral', itemCode: 'HAP-0003' },
  { id: 4, name: 'Pleated Wrap Skort — Brown Check', itemCode: 'HAP-0005' },
];

test('an item code in the ad link identifies the item outright', () => {
  const match = resolveProductFromAdReferral(
    { headline: 'Weekend deals', sourceUrl: 'https://happybuyfashion.com/p/HAP-0005' },
    CATALOG
  );
  assert.equal(match?.id, 4);
});

test('a full product name in the headline identifies the item', () => {
  const match = resolveProductFromAdReferral(
    { headline: 'Pleated Wrap Skort — Brown Check, now Rs 1990', sourceUrl: null },
    CATALOG
  );
  assert.equal(match?.id, 4);
});

test('an ad naming a family rather than an item names nobody', () => {
  // Three colourways share "Tie-Strap Smocked Sundress"; guessing one and
  // telling the customer it is "the item in that ad" would be a lie.
  const match = resolveProductFromAdReferral(
    { headline: 'Tie-Strap Smocked Sundress', sourceUrl: null },
    CATALOG
  );
  assert.equal(match, null);
});

test('a generic ad names nobody rather than guessing', () => {
  assert.equal(resolveProductFromAdReferral({ headline: 'Big sizes, small prices', sourceUrl: 'https://happybuyfashion.com' }, CATALOG), null);
  assert.equal(resolveProductFromAdReferral({ headline: '', sourceUrl: '' }, CATALOG), null);
  assert.equal(resolveProductFromAdReferral({ headline: 'Sale now on', sourceUrl: null }, []), null);
});

test('a colourway named in the ad wins over its siblings', () => {
  const match = resolveProductFromAdReferral(
    { headline: 'Tie-Strap Smocked Sundress — Cream Red Floral', sourceUrl: null },
    CATALOG
  );
  assert.equal(match?.id, 2);
});

test('the opening line names the item, its price and how to go on', () => {
  const reply = buildAdArrivalReply({
    customerName: 'dilula',
    brandName: 'Happybuy',
    productName: 'Pleated Wrap Skort — Brown Check',
    itemCode: 'HAP-0005',
    price: 'Rs 1990',
    sizes: 'S, M, L, XL',
  });

  assert.match(reply, /^Hi dilula, welcome to Happybuy\./);
  assert.match(reply, /Pleated Wrap Skort — Brown Check — Rs 1990/);
  assert.match(reply, /Sizes: S, M, L, XL/);
  assert.match(reply, /Item code: HAP-0005/);
  // Never asks them to describe what they just tapped.
  assert.doesNotMatch(reply, /which item|what can I help you find/i);
});

test('an unnamed customer still gets a welcome rather than "Hi null"', () => {
  const reply = buildAdArrivalReply({
    customerName: null,
    brandName: 'Happybuy',
    productName: 'Pleated Wrap Skort',
    price: 'Rs 1990',
    sizes: 'S, M',
  });
  assert.match(reply, /^Welcome to Happybuy\./);
  assert.doesNotMatch(reply, /null|undefined/);
});
