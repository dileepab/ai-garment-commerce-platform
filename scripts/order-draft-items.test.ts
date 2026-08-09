import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateDraftTotal,
  currentDraftItem,
  describeDraftItem,
  draftBrands,
  draftItemCount,
  draftItems,
  draftItemsSubtotal,
  isSameDraftItem,
  settleCurrentDraftItem,
  startNewDraftItem,
  withDraftTotal,
} from '../src/lib/order-draft/items.ts';
import { looksLikeItemAdditionRequest } from '../src/lib/order-draft/addition-intent.ts';

const BASE_DRAFT = {
  productId: 6,
  productName: 'Cream Red Floral Dress',
  brand: 'happybuy',
  variantId: 31,
  quantity: 1,
  size: 'M',
  color: 'Cream Red Floral',
  price: 1990,
  deliveryCharge: 425,
  total: 2415,
  paymentMethod: 'Cash on delivery',
  giftWrap: false,
  deliveryEstimate: '1-2 business days',
  name: 'Nimali Perera',
  address: '12 Galle Road, Dehiwala, Colombo',
  streetAddress: '12 Galle Road',
  city: 'Dehiwala',
  district: 'Colombo',
  phone: '0714123777',
};

const BLUE_ITEM = {
  productId: 7,
  productName: 'Blue Grey Dress',
  brand: 'happybuy',
  variantId: 35,
  quantity: 1,
  size: 'S',
  color: 'Blue Grey',
  price: 2490,
};

test('a fresh draft is a single item', () => {
  assert.equal(draftItemCount(BASE_DRAFT), 1);
  assert.deepEqual(draftItems(BASE_DRAFT), [currentDraftItem(BASE_DRAFT)]);
});

test('settled items come before the one being specified', () => {
  const draft = { ...BASE_DRAFT, previousItems: [BLUE_ITEM] };

  assert.equal(draftItemCount(draft), 2);
  assert.deepEqual(
    draftItems(draft).map((item) => item.productName),
    ['Blue Grey Dress', 'Cream Red Floral Dress']
  );
});

// Delivery goes to one address whichever way you count it. Charging it twice
// for a two-item order is a real overcharge.
test('delivery is charged once no matter how many items', () => {
  const draft = { ...BASE_DRAFT, previousItems: [BLUE_ITEM] };

  assert.equal(draftItemsSubtotal(draft), 1990 + 2490);
  assert.equal(calculateDraftTotal(draft), 1990 + 2490 + 425);
});

test('quantities count towards the subtotal', () => {
  const draft = {
    ...BASE_DRAFT,
    quantity: 3,
    previousItems: [{ ...BLUE_ITEM, quantity: 2 }],
  };

  assert.equal(calculateDraftTotal(draft), 1990 * 3 + 2490 * 2 + 425);
});

test('withDraftTotal restates the stored total', () => {
  const draft = withDraftTotal({ ...BASE_DRAFT, previousItems: [BLUE_ITEM], total: 0 });

  assert.equal(draft.total, 1990 + 2490 + 425);
});

test('the same variant of the same product is the same item', () => {
  const item = currentDraftItem(BASE_DRAFT);

  assert.equal(isSameDraftItem(item, { ...item }), true);
  assert.equal(isSameDraftItem(item, { ...item, variantId: 99 }), false);
  assert.equal(isSameDraftItem(item, BLUE_ITEM), false);
});

test('items without variant ids fall back to size and colour', () => {
  const a = { ...currentDraftItem(BASE_DRAFT), variantId: undefined };
  const b = { ...a };

  assert.equal(isSameDraftItem(a, b), true);
  assert.equal(isSameDraftItem(a, { ...b, size: 'L' }), false);
});

// Two lines of the same dress is something a picker has to reconcile by hand.
test('adding an item already in the order raises its quantity', () => {
  const draft = { ...BASE_DRAFT, quantity: 2, previousItems: [currentDraftItem(BASE_DRAFT)] };
  const settled = settleCurrentDraftItem(draft);

  assert.equal(settled.length, 1);
  assert.equal(settled[0].quantity, 3);
});

test('starting a new item files the current one away', () => {
  const draft = startNewDraftItem(BASE_DRAFT, { quantity: null, keepVariant: false });

  assert.deepEqual(
    draft.previousItems?.map((item) => item.productName),
    ['Cream Red Floral Dress']
  );
  assert.equal(draft.size, undefined);
  assert.equal(draft.color, undefined);
  assert.equal(draft.variantId, undefined);
  assert.equal(draft.quantity, 1);
});

// "Also in L" is the same dress, so the colour they already picked still holds.
test('a new size of the same product keeps the colour', () => {
  const draft = startNewDraftItem(BASE_DRAFT, { quantity: 2, keepVariant: true });

  assert.equal(draft.color, 'Cream Red Floral');
  assert.equal(draft.quantity, 2);
  assert.equal(draft.previousItems?.length, 1);
});

test('contact and delivery details survive starting a new item', () => {
  const draft = startNewDraftItem(BASE_DRAFT, { quantity: null, keepVariant: false });

  assert.equal(draft.name, 'Nimali Perera');
  assert.equal(draft.phone, '0714123777');
  assert.equal(draft.deliveryCharge, 425);
  assert.equal(draft.paymentMethod, 'Cash on delivery');
});

test('a mixed-brand order is visible', () => {
  const draft = { ...BASE_DRAFT, previousItems: [{ ...BLUE_ITEM, brand: 'deez' }] };

  assert.deepEqual(draftBrands(draft).sort(), ['deez', 'happybuy']);
});

test('an item reads back the way it was chosen', () => {
  assert.equal(
    describeDraftItem({ ...BLUE_ITEM, quantity: 2 }),
    'Blue Grey Dress (Blue Grey, S) × 2'
  );
  assert.equal(describeDraftItem(BLUE_ITEM), 'Blue Grey Dress (Blue Grey, S)');
});

test('wording that means "as well as" is an addition', () => {
  for (const message of [
    'also send the blue one in M',
    'add the linen pants too',
    'can I get one more in L',
    'another one in size S as well',
    'තවත් එකක් L size එකෙන් එවන්න',
    'thawa ekak blue eken denna',
    'innum oru dress venum',
  ]) {
    assert.equal(looksLikeItemAdditionRequest(message), true, message);
  }
});

// Reading a correction as an addition puts something in the order the customer
// never asked for; the reverse throws away what they said. Corrections win.
test('a correction is never read as an addition', () => {
  for (const message of [
    'actually make it L',
    'change it to the blue one instead',
    'no, make it size M',
    'cancel that and add the blue one',
    'වෙනුවට blue එක එවන්න',
  ]) {
    assert.equal(looksLikeItemAdditionRequest(message), false, message);
  }
});

test('an ordinary order message is not an addition', () => {
  for (const message of [
    'I want the Cream Red Floral Dress in M',
    'size M please',
    'what colors do you have',
    '',
  ]) {
    assert.equal(looksLikeItemAdditionRequest(message), false, message);
  }
});
