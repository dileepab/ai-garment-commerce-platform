import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRemainingCartNote,
  buildUnavailableCartNote,
  describePendingCartItem,
  takeNextCartItemDraft,
} from '../src/lib/cart-followup.ts';

const PRODUCTS = [
  {
    id: 6,
    name: 'Cream Red Floral Dress',
    brand: 'happybuy',
    price: 1990,
    variants: [
      { id: 31, size: 'M', color: 'Cream Red Floral', inventory: { availableQty: 4 } },
      { id: 32, size: 'L', color: 'Cream Red Floral', inventory: { availableQty: 0 } },
    ],
  },
  {
    id: 7,
    name: 'Blue Grey Dress',
    brand: 'happybuy',
    price: 2490,
    variants: [{ id: 35, size: 'S', color: 'Blue Grey', inventory: { availableQty: 2 } }],
  },
];

const CONFIRMED_DRAFT = {
  productId: 9,
  productName: 'Something Already Ordered',
  brand: 'happybuy',
  variantId: 90,
  quantity: 1,
  size: 'S',
  color: 'Black',
  price: 3000,
  deliveryCharge: 350,
  total: 3350,
  paymentMethod: 'Cash on delivery',
  giftWrap: false,
  deliveryEstimate: '2-3 days',
  name: 'Nimali Perera',
  address: '12 Galle Road, Dehiwala, Colombo',
  streetAddress: '12 Galle Road',
  city: 'Dehiwala',
  district: 'Colombo',
  phone: '0714123777',
};

const PENDING_M = {
  productId: 6,
  productName: 'Cream Red Floral Dress',
  variantId: 31,
  size: 'M',
  color: 'Cream Red Floral',
  quantity: 2,
};

const PENDING_L_SOLD_OUT = {
  productId: 6,
  productName: 'Cream Red Floral Dress',
  variantId: 32,
  size: 'L',
  color: 'Cream Red Floral',
  quantity: 1,
};

const PENDING_BLUE = {
  productId: 7,
  productName: 'Blue Grey Dress',
  variantId: 35,
  size: 'S',
  color: 'Blue Grey',
  quantity: 1,
};

test('the next cart item becomes a draft priced from its own product', () => {
  const result = takeNextCartItemDraft([PENDING_M, PENDING_BLUE], PRODUCTS, CONFIRMED_DRAFT);

  assert.ok(result.draft);
  assert.equal(result.draft.productId, 6);
  assert.equal(result.draft.variantId, 31);
  assert.equal(result.draft.size, 'M');
  assert.equal(result.draft.color, 'Cream Red Floral');
  assert.equal(result.draft.quantity, 2);
  assert.equal(result.draft.price, 1990);
  assert.equal(result.draft.total, 1990 * 2 + 350);
});

// Same customer, same cart, same delivery — asking for the address again would
// be the bot forgetting a conversation it just had.
test('delivery details carry over from the order just confirmed', () => {
  const result = takeNextCartItemDraft([PENDING_M], PRODUCTS, CONFIRMED_DRAFT);

  assert.equal(result.draft?.name, 'Nimali Perera');
  assert.equal(result.draft?.streetAddress, '12 Galle Road');
  assert.equal(result.draft?.city, 'Dehiwala');
  assert.equal(result.draft?.district, 'Colombo');
  assert.equal(result.draft?.phone, '0714123777');
  assert.equal(result.draft?.paymentMethod, 'Cash on delivery');
  assert.equal(result.draft?.deliveryCharge, 350);
});

test('items behind the drafted one keep waiting', () => {
  const result = takeNextCartItemDraft([PENDING_M, PENDING_BLUE], PRODUCTS, CONFIRMED_DRAFT);

  assert.deepEqual(result.remaining, [PENDING_BLUE]);
});

// A cart can sit through a whole conversation. Confirming an order for
// something that sold out in between is the worst possible outcome.
test('an item that sold out is skipped and reported', () => {
  const result = takeNextCartItemDraft(
    [PENDING_L_SOLD_OUT, PENDING_BLUE],
    PRODUCTS,
    CONFIRMED_DRAFT
  );

  assert.equal(result.draft?.variantId, 35);
  assert.deepEqual(result.unavailable, [PENDING_L_SOLD_OUT]);
  assert.deepEqual(result.remaining, []);
});

test('a product that is gone entirely is skipped', () => {
  const retired = { ...PENDING_M, productId: 404, variantId: 4040 };
  const result = takeNextCartItemDraft([retired, PENDING_BLUE], PRODUCTS, CONFIRMED_DRAFT);

  assert.equal(result.draft?.variantId, 35);
  assert.deepEqual(result.unavailable, [retired]);
});

test('nothing orderable leaves no draft and nothing waiting', () => {
  const result = takeNextCartItemDraft([PENDING_L_SOLD_OUT], PRODUCTS, CONFIRMED_DRAFT);

  assert.equal(result.draft, null);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(result.unavailable, [PENDING_L_SOLD_OUT]);
});

test('an empty cart is a clean no-op', () => {
  const result = takeNextCartItemDraft([], PRODUCTS, CONFIRMED_DRAFT);

  assert.equal(result.draft, null);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(result.unavailable, []);
});

// Quoting three when two are left means the confirmation fails at order
// creation, after the customer has already said yes.
test('quantity is clamped to what is left on the shelf', () => {
  const result = takeNextCartItemDraft(
    [{ ...PENDING_BLUE, quantity: 9 }],
    PRODUCTS,
    CONFIRMED_DRAFT
  );

  assert.equal(result.draft?.quantity, 2);
  assert.equal(result.draft?.total, 2490 * 2 + 350);
});

test('a cart item reads back the way the customer chose it', () => {
  assert.equal(
    describePendingCartItem(PENDING_M),
    'Cream Red Floral Dress — Cream Red Floral, size M × 2'
  );
  assert.equal(
    describePendingCartItem(PENDING_BLUE),
    'Blue Grey Dress — Blue Grey, size S'
  );
});

test('the remaining-cart note names every item', () => {
  const note = buildRemainingCartNote([PENDING_M, PENDING_BLUE]);

  assert.ok(note);
  assert.match(note, /these 2 items/);
  assert.ok(note.includes('Cream Red Floral Dress'));
  assert.ok(note.includes('Blue Grey Dress'));
});

test('nothing waiting means no note at all', () => {
  assert.equal(buildRemainingCartNote([]), null);
  assert.equal(buildUnavailableCartNote([]), null);
});

test('a sold-out cart item is explained rather than dropped', () => {
  const note = buildUnavailableCartNote([PENDING_L_SOLD_OUT]);

  assert.ok(note);
  assert.ok(note.includes('Cream Red Floral Dress'));
  assert.match(note, /out of stock/);
});
