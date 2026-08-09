import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildProductListPayload,
  buildSingleProductPayload,
} from '../src/lib/whatsapp-product-message.ts';

const CATALOG_ID = '3015545675306799';

test('a single product renders as a product card', () => {
  const payload = buildSingleProductPayload({
    recipient: '94702694270',
    catalogId: CATALOG_ID,
    retailerId: 'HAP-0002-V31',
    body: 'Tie-Strap Smocked Sundress — Cream Red Floral',
  }) as Record<string, never>;

  assert.equal(payload.type, 'interactive');
  const interactive = payload.interactive as Record<string, never>;
  assert.equal(interactive.type, 'product');
  const action = interactive.action as Record<string, never>;
  assert.equal(action.catalog_id, CATALOG_ID);
  assert.equal(action.product_retailer_id, 'HAP-0002-V31');
});

// A guessed id renders an empty card instead of erroring, so refusing to build
// without one is the only way the caller learns to fall back to text.
test('no payload is built without a catalog or retailer id', () => {
  assert.equal(
    buildSingleProductPayload({ recipient: '94702694270', catalogId: '', retailerId: 'HAP-0002-V31' }),
    null
  );
  assert.equal(
    buildSingleProductPayload({ recipient: '94702694270', catalogId: CATALOG_ID, retailerId: '  ' }),
    null
  );
});

test('several products render as a product list', () => {
  const payload = buildProductListPayload({
    recipient: '94702694270',
    catalogId: CATALOG_ID,
    header: 'Our sundresses',
    body: 'Tap an item to see sizes and add it to your cart.',
    sections: [
      {
        title: 'Available now',
        products: [
          { retailerId: 'HAP-0001-V21' },
          { retailerId: 'HAP-0002-V31' },
          { retailerId: 'HAP-0003-V35' },
        ],
      },
    ],
  }) as Record<string, never>;

  const interactive = payload.interactive as Record<string, never>;
  assert.equal(interactive.type, 'product_list');
  const action = interactive.action as Record<string, never>;
  const sections = action.sections as Array<{ product_items: Array<{ product_retailer_id: string }> }>;
  assert.equal(sections.length, 1);
  assert.deepEqual(
    sections[0].product_items.map((item) => item.product_retailer_id),
    ['HAP-0001-V21', 'HAP-0002-V31', 'HAP-0003-V35']
  );
});

// A one-row list is a worse card than an actual card.
test('a list holding one product collapses to a single product card', () => {
  const payload = buildProductListPayload({
    recipient: '94702694270',
    catalogId: CATALOG_ID,
    header: 'Our sundresses',
    body: 'Only one left in that colour.',
    sections: [{ title: 'Available now', products: [{ retailerId: 'HAP-0002-V31' }] }],
  }) as Record<string, never>;

  const interactive = payload.interactive as Record<string, never>;
  assert.equal(interactive.type, 'product');
  assert.equal(
    (interactive.action as Record<string, never>).product_retailer_id,
    'HAP-0002-V31'
  );
});

test('sections left empty after filtering are dropped', () => {
  const payload = buildProductListPayload({
    recipient: '94702694270',
    catalogId: CATALOG_ID,
    header: 'Our sundresses',
    body: 'Tap an item.',
    sections: [
      { title: 'Sold out', products: [{ retailerId: '' }] },
      { title: 'Available now', products: [{ retailerId: 'HAP-0002-V31' }, { retailerId: 'HAP-0003-V35' }] },
    ],
  }) as Record<string, never>;

  const action = (payload.interactive as Record<string, never>).action as Record<string, never>;
  const sections = action.sections as Array<{ title: string }>;
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, 'Available now');
});

// Returning null is what lets the webhook keep the old text list.
test('nothing usable yields null so the caller can fall back to text', () => {
  assert.equal(
    buildProductListPayload({
      recipient: '94702694270',
      catalogId: CATALOG_ID,
      header: 'Our sundresses',
      body: 'Tap an item.',
      sections: [{ title: 'Available now', products: [] }],
    }),
    null
  );

  assert.equal(
    buildProductListPayload({
      recipient: '94702694270',
      catalogId: '',
      header: 'Our sundresses',
      body: 'Tap an item.',
      sections: [{ title: 'Available now', products: [{ retailerId: 'HAP-0002-V31' }] }],
    }),
    null
  );
});

test('over-long header, body and footer are truncated to Meta limits', () => {
  const payload = buildProductListPayload({
    recipient: '94702694270',
    catalogId: CATALOG_ID,
    header: 'H'.repeat(200),
    body: 'B'.repeat(2000),
    footer: 'F'.repeat(200),
    sections: [
      { title: 'T'.repeat(200), products: [{ retailerId: 'HAP-0002-V31' }, { retailerId: 'HAP-0003-V35' }] },
    ],
  }) as Record<string, never>;

  const interactive = payload.interactive as Record<string, never>;
  const header = interactive.header as { text: string };
  const body = interactive.body as { text: string };
  const footer = interactive.footer as { text: string };
  const sections = (interactive.action as Record<string, never>).sections as Array<{ title: string }>;

  assert.ok(header.text.length <= 60, `header was ${header.text.length}`);
  assert.ok(body.text.length <= 1024, `body was ${body.text.length}`);
  assert.ok(footer.text.length <= 60, `footer was ${footer.text.length}`);
  assert.ok(sections[0].title.length <= 60, `title was ${sections[0].title.length}`);
});

test('a section is capped at the catalog limit', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ retailerId: `HAP-0001-V${index}` }));
  const payload = buildProductListPayload({
    recipient: '94702694270',
    catalogId: CATALOG_ID,
    header: 'Our sundresses',
    body: 'Tap an item.',
    sections: [{ title: 'Available now', products: many }],
  }) as Record<string, never>;

  const action = (payload.interactive as Record<string, never>).action as Record<string, never>;
  const sections = action.sections as Array<{ product_items: unknown[] }>;
  assert.equal(sections[0].product_items.length, 30);
});

// A card whose retailer id is not in the catalog renders blank rather than
// failing, so the ids the bot sends must be built the same way the feed builds
// them. This pins the two together.
test('card retailer ids match the ids published in the catalog feed', async () => {
  const { buildMetaCatalogVariantRetailerId, mapProductToMetaCatalogRows, getMetaCatalogBrand } =
    await import('../src/lib/meta-catalog-feed.ts');

  const product = {
    id: 6,
    sku: 'HAP-0002',
    name: 'Tie-Strap Smocked Sundress — Cream Red Floral',
    brand: 'Happybuy',
    style: 'summer_dress',
    price: 1990,
    fabric: 'Cheesecloth',
    sizes: 'S, M',
    colors: 'Cream Red Floral',
    stock: 10,
    status: 'active',
    imageUrl: 'https://cdn.example.com/cream.jpg',
    inventory: { availableQty: 10 },
    colorImages: [],
    creatives: [],
    variants: [
      { id: 31, sku: null, size: 'S', color: 'Cream Red Floral', status: 'active', inventory: { availableQty: 5 } },
      { id: 32, sku: null, size: 'M', color: 'Cream Red Floral', status: 'active', inventory: { availableQty: 5 } },
    ],
  };

  const feedIds = mapProductToMetaCatalogRows(product, getMetaCatalogBrand('happybuy')!).map((row) => row.id);
  // What the chat layer would send a card for: the first sellable variant.
  const cardId = buildMetaCatalogVariantRetailerId(product, product.variants[0]);

  assert.ok(
    feedIds.includes(cardId),
    `card id ${cardId} is not in the feed (${feedIds.join(', ')})`
  );
  assert.equal(cardId, 'HAP-0002-V31');
});
