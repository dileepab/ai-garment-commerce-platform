import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeCart,
  extractWhatsAppCart,
  parseCatalogRetailerId,
} from '../src/lib/whatsapp-cart.ts';

// The message WhatsApp sends when a customer taps "Add to cart" and sends it.
const ORDER_MESSAGE = {
  type: 'order',
  order: {
    catalog_id: '3015545675306799',
    text: 'Can I get this by Friday?',
    product_items: [
      { product_retailer_id: 'HAP-0002-V31', quantity: 2, item_price: 1990, currency: 'LKR' },
      { product_retailer_id: 'HAP-0003-V35', quantity: 1, item_price: 1990, currency: 'LKR' },
    ],
  },
};

test('a cart message yields its items, quantities and note', () => {
  const cart = extractWhatsAppCart(ORDER_MESSAGE);

  assert.ok(cart);
  assert.equal(cart.catalogId, '3015545675306799');
  assert.equal(cart.note, 'Can I get this by Friday?');
  assert.deepEqual(
    cart.items.map((item) => [item.retailerId, item.quantity]),
    [['HAP-0002-V31', 2], ['HAP-0003-V35', 1]]
  );
  assert.equal(cart.items[0].itemPrice, 1990);
});

test('an ordinary text message is not a cart', () => {
  assert.equal(extractWhatsAppCart({ type: 'text', text: { body: 'hello' } }), null);
  assert.equal(extractWhatsAppCart(null), null);
  assert.equal(extractWhatsAppCart('order'), null);
});

// Treating an unreadable order as a cart would replace a real message with
// silence, so it has to fall through to the normal text path.
test('an order with no readable items is not treated as a cart', () => {
  assert.equal(extractWhatsAppCart({ type: 'order', order: { product_items: [] } }), null);
  assert.equal(
    extractWhatsAppCart({ type: 'order', order: { product_items: [{ quantity: 2 }] } }),
    null
  );
});

test('a missing or invalid quantity falls back to one', () => {
  const cart = extractWhatsAppCart({
    type: 'order',
    order: { product_items: [{ product_retailer_id: 'HAP-0002-V31', quantity: 0 }] },
  });

  assert.equal(cart?.items[0].quantity, 1);
});

test('quantities arriving as strings are read', () => {
  const cart = extractWhatsAppCart({
    type: 'order',
    order: { product_items: [{ product_retailer_id: 'HAP-0002-V31', quantity: '3' }] },
  });

  assert.equal(cart?.items[0].quantity, 3);
});

test('a generated retailer id gives back its variant row id', () => {
  const parsed = parseCatalogRetailerId('HAP-0002-V31');

  assert.equal(parsed.variantId, 31);
  assert.equal(parsed.raw, 'HAP-0002-V31');
});

// A variant SKU is passed through verbatim, so the caller can look it up.
test('a retailer id that is a variant SKU yields no variant id', () => {
  const parsed = parseCatalogRetailerId('HB-0042-BLU-S');

  assert.equal(parsed.variantId, null);
  assert.equal(parsed.raw, 'HB-0042-BLU-S');
});

// Both readings are returned precisely because a SKU can look like a suffix —
// the database decides, rather than this guessing and attaching an order to the
// wrong variant.
test('a SKU that looks like a generated id keeps both readings', () => {
  const parsed = parseCatalogRetailerId('CUSTOM-V99');

  assert.equal(parsed.variantId, 99);
  assert.equal(parsed.raw, 'CUSTOM-V99');
});

test('a cart is described for the conversation log', () => {
  assert.equal(
    describeCart(extractWhatsAppCart(ORDER_MESSAGE)!),
    'Cart: 2 × HAP-0002-V31, 1 × HAP-0003-V35 — "Can I get this by Friday?"'
  );
});

// The loop that matters: the id we put on a card must come back from the cart
// and resolve to the same variant. A break anywhere here attaches the order to
// the wrong item, which is exactly the failure this feature exists to remove.
test('a card id survives the round trip back to its variant', async () => {
  const { buildMetaCatalogVariantRetailerId } = await import('../src/lib/meta-catalog-feed.ts');

  const product = { id: 6, sku: 'HAP-0002' };
  const variant = { id: 31, sku: null, size: 'M', color: 'Cream Red Floral' };

  const sentOnCard = buildMetaCatalogVariantRetailerId(product, variant);
  const cart = extractWhatsAppCart({
    type: 'order',
    order: { product_items: [{ product_retailer_id: sentOnCard, quantity: 2 }] },
  });
  const parsed = parseCatalogRetailerId(cart!.items[0].retailerId);

  assert.equal(sentOnCard, 'HAP-0002-V31');
  assert.equal(parsed.variantId, variant.id, 'cart did not resolve to the variant the card pointed at');
  assert.equal(cart!.items[0].quantity, 2);
});

test('a variant with its own SKU round-trips by SKU', async () => {
  const { buildMetaCatalogVariantRetailerId } = await import('../src/lib/meta-catalog-feed.ts');

  const product = { id: 42, sku: 'HB-0042' };
  const variant = { id: 101, sku: 'HB-0042-BLU-S', size: 'S', color: 'Blue' };

  const sentOnCard = buildMetaCatalogVariantRetailerId(product, variant);
  const parsed = parseCatalogRetailerId(sentOnCard);

  assert.equal(sentOnCard, 'HB-0042-BLU-S');
  // No generated suffix, so the raw id is what identifies the variant.
  assert.equal(parsed.variantId, null);
  assert.equal(parsed.raw, variant.sku);
});
