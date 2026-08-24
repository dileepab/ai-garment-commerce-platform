import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_QUANTITY_PER_ITEM,
  normaliseSriLankanPhone,
  parseStorefrontOrder,
  resolveBrandSlug,
} from '../src/lib/storefront-checkout.ts';

const VALID = {
  brand: 'happybuy',
  name: 'Nimali Perera',
  phone: '0771234567',
  streetAddress: '42 Galle Road',
  city: 'Panadura',
  district: 'Kalutara',
  items: [{ productId: 7, quantity: 1, size: 'M' }],
};

test('a complete order from the website is accepted', () => {
  const result = parseStorefrontOrder(VALID);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.brand, 'Happybuy');
  assert.equal(result.value.phone, '0771234567');
  assert.deepEqual(result.value.items, [
    { productId: 7, quantity: 1, size: 'M', color: undefined },
  ]);
});

test('every way a shopper types their number reaches the courier the same', () => {
  for (const typed of ['0771234567', '+94771234567', '94 77 123 4567', '0094771234567', '771234567']) {
    assert.equal(normaliseSriLankanPhone(typed), '0771234567', `typed: ${typed}`);
  }

  // A landline or a truncated number would fail at the courier, long after
  // the sale looked complete.
  assert.equal(normaliseSriLankanPhone('0112345678'), null);
  assert.equal(normaliseSriLankanPhone('077123456'), null);
  assert.equal(normaliseSriLankanPhone(''), null);
  assert.equal(normaliseSriLankanPhone(undefined), null);
});

test('a price sent by the browser is ignored entirely', () => {
  const result = parseStorefrontOrder({
    ...VALID,
    items: [{ productId: 7, quantity: 1, price: 1, unitPrice: 1 }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The catalogue is the only source of price; nothing priced survives parsing.
  assert.deepEqual(Object.keys(result.value.items[0]).sort(), ['color', 'productId', 'quantity', 'size']);
});

test('an order that cannot be delivered is refused before it is taken', () => {
  const missing = [
    [{ ...VALID, name: '' }, 'no name'],
    [{ ...VALID, phone: 'abc' }, 'no usable phone'],
    [{ ...VALID, streetAddress: '' }, 'no address'],
    [{ ...VALID, city: '' }, 'no city'],
    [{ ...VALID, items: [] }, 'empty cart'],
    [{ ...VALID, brand: 'notabrand' }, 'unknown brand'],
  ] as const;

  for (const [body, label] of missing) {
    assert.equal(parseStorefrontOrder(body).ok, false, label);
  }
});

test('quantities are capped so one request cannot claim the stock room', () => {
  const tooMany = parseStorefrontOrder({
    ...VALID,
    items: [{ productId: 7, quantity: MAX_QUANTITY_PER_ITEM + 1 }],
  });
  assert.equal(tooMany.ok, false);

  for (const bad of [0, -1, 1.5, 'two']) {
    assert.equal(
      parseStorefrontOrder({ ...VALID, items: [{ productId: 7, quantity: bad }] }).ok,
      false,
      `quantity: ${bad}`
    );
  }
});

test('the district falls back to the city rather than shipping nowhere', () => {
  const result = parseStorefrontOrder({ ...VALID, district: '' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.district, 'Panadura');
});

test('the ad click is carried through so the sale can be credited', () => {
  const result = parseStorefrontOrder({ ...VALID, adClickId: 'ARAaBBcc_click' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.adClickId, 'ARAaBBcc_click');

  const organic = parseStorefrontOrder(VALID);
  assert.equal(organic.ok && organic.value.adClickId, null);
});

test('only real brand slugs resolve', () => {
  assert.equal(resolveBrandSlug('HAPPYBUY'), 'Happybuy');
  assert.equal(resolveBrandSlug('cleopatra'), 'Cleopatra');
  assert.equal(resolveBrandSlug('__proto__'), null);
  assert.equal(resolveBrandSlug(''), null);
});
