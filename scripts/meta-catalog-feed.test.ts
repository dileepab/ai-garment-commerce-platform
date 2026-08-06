import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCatalogProductUrl,
  buildMetaCatalogProduct,
  buildMetaCatalogProducts,
  buildMetaCatalogCsv,
  escapeCsvCell,
  getCatalogAvailableQuantity,
  getMetaCatalogBrand,
  mapProductToMetaCatalogRow,
  mapProductToMetaCatalogRows,
  selectCatalogImageUrl,
  type MetaCatalogFeedProduct,
} from '../src/lib/meta-catalog-feed.ts';

function product(overrides: Partial<MetaCatalogFeedProduct> = {}): MetaCatalogFeedProduct {
  return {
    id: 42,
    sku: 'HB-0042',
    name: 'Linen Day Dress',
    brand: 'Happybuy',
    style: 'Casual, everyday',
    price: 3490,
    fabric: 'Linen blend',
    sizes: 'S, M, L',
    colors: 'Blue, White',
    stock: 7,
    status: 'active',
    imageUrl: 'https://cdn.example.com/products/day-dress.jpg',
    fitType: 'Relaxed',
    inventory: { availableQty: 7 },
    variants: [],
    colorImages: [],
    creatives: [],
    ...overrides,
  };
}

describe('Meta catalog brand and product links', () => {
  test('normalizes supported brand aliases and rejects unsupported brands', () => {
    assert.equal(getMetaCatalogBrand('Happy Buy')?.key, 'happybuy');
    assert.equal(getMetaCatalogBrand('happyby')?.key, 'happybuy');
    assert.equal(getMetaCatalogBrand('CLEOPATRA')?.key, 'cleopatra');
    assert.equal(getMetaCatalogBrand('Modabella')?.key, 'modabella');
    assert.equal(getMetaCatalogBrand('deez'), null);
  });

  test('uses each brand storefront and the same name-id slug as the storefront API', () => {
    const item = product({ id: 73, name: 'Summer Wrap Dress!' });
    assert.equal(
      buildCatalogProductUrl(getMetaCatalogBrand('happybuy')!, item),
      'https://happybuyfashion.com/p/summer-wrap-dress-73',
    );
    assert.equal(
      buildCatalogProductUrl(getMetaCatalogBrand('cleopatra')!, item),
      'https://cleopatraforever.com/p/summer-wrap-dress-73',
    );
    assert.equal(
      buildCatalogProductUrl(getMetaCatalogBrand('modabella')!, item),
      'https://lovemodabella.com/p/summer-wrap-dress-73',
    );
  });
});

describe('Meta catalog mapping', () => {
  test('maps a product to required Meta feed fields with LKR pricing', () => {
    const catalogProduct = buildMetaCatalogProduct(product(), getMetaCatalogBrand('happybuy')!);
    const row = mapProductToMetaCatalogRow(product(), getMetaCatalogBrand('happybuy')!);

    assert.ok(catalogProduct);
    assert.equal(catalogProduct.retailerId, 'HB-0042');
    assert.equal(catalogProduct.price, 3490);
    assert.equal(catalogProduct.currency, 'LKR');
    assert.ok(row);
    assert.equal(row.id, 'HB-0042');
    assert.equal(row.title, 'Linen Day Dress');
    assert.match(row.description, /Style: Casual, everyday/);
    assert.match(row.description, /Sizes: S, M, L/);
    assert.equal(row.availability, 'in stock');
    assert.equal(row.condition, 'new');
    assert.equal(row.price, '3490.00 LKR');
    assert.equal(row.link, 'https://happybuyfashion.com/p/linen-day-dress-42');
    assert.equal(row.image_link, 'https://cdn.example.com/products/day-dress.jpg');
    assert.equal(row.brand, 'Happybuy');
  });

  test('uses active variant inventory when variants exist', () => {
    const item = product({
      stock: 20,
      inventory: { availableQty: 20 },
      variants: [
        { id: 1, status: 'active', inventory: { availableQty: 2 } },
        { id: 2, status: 'out-of-stock', inventory: { availableQty: 0 } },
        { id: 3, status: 'archived', inventory: { availableQty: 50 } },
      ],
    });
    assert.equal(getCatalogAvailableQuantity(item), 2);
    assert.equal(
      mapProductToMetaCatalogRow(item, getMetaCatalogBrand('happybuy')!)?.availability,
      'in stock',
    );
  });

  test('falls back through public color and saved creative images', () => {
    const colorFallback = product({
      imageUrl: 'http://insecure.example.com/product.jpg',
      colorImages: [{ imageUrl: 'https://cdn.example.com/products/blue.jpg' }],
    });
    assert.equal(
      selectCatalogImageUrl(colorFallback, 'https://app.deez.lk'),
      'https://cdn.example.com/products/blue.jpg',
    );

    const creativeFallback = product({
      imageUrl: null,
      colorImages: [{ imageUrl: '/private/product.jpg' }],
      creatives: [{ id: 991, status: 'saved' }],
    });
    assert.equal(
      selectCatalogImageUrl(creativeFallback, 'https://app.deez.lk/'),
      'https://app.deez.lk/api/content/creatives/991/image',
    );
  });

  // The stored photos are dummy shots on a phone, so an ad should show the
  // creative even when a perfectly valid product photo exists.
  test('prefers a saved creative over a usable product photo', () => {
    const withBoth = product({
      imageUrl: 'https://cdn.example.com/products/day-dress.jpg',
      colorImages: [{ imageUrl: 'https://cdn.example.com/products/blue.jpg' }],
      creatives: [{ id: 991, status: 'saved', imageUrl: 'https://blob.example/creative-991.jpg' }],
    });

    assert.equal(
      selectCatalogImageUrl(withBoth, 'https://app.deez.lk'),
      'https://blob.example/creative-991.jpg',
    );
  });

  test('a published creative outranks an unpublished one in the feed', () => {
    const withBoth = product({
      creatives: [
        { id: 1, status: 'saved', viewAngle: 'front', imageUrl: 'https://blob.example/unpublished.jpg' },
        {
          id: 2,
          status: 'saved',
          viewAngle: 'front',
          imageUrl: 'https://blob.example/published.jpg',
          publishedAt: '2026-08-06T00:00:00Z',
        },
      ],
    });

    assert.equal(
      selectCatalogImageUrl(withBoth, 'https://app.deez.lk'),
      'https://blob.example/published.jpg',
    );
  });

  test('skips archived/deleted products and products without an HTTPS image', () => {
    const brand = getMetaCatalogBrand('happybuy')!;
    assert.equal(mapProductToMetaCatalogRow(product({ status: 'ARCHIVED' }), brand), null);
    assert.equal(mapProductToMetaCatalogRow(product({ status: 'deleted' }), brand), null);
    assert.equal(mapProductToMetaCatalogRow(product({ sku: '  ' }), brand)?.id, 'PRODUCT-42');
    assert.equal(
      mapProductToMetaCatalogRow(
        product({ imageUrl: 'http://cdn.example.com/image.jpg', colorImages: [], creatives: [] }),
        brand,
      ),
      null,
    );
  });

  test('publishes sellable garment variants with their own stock, price, image, and options', () => {
    const item = product({
      variants: [
        {
          id: 101,
          sku: 'HB-0042-BLU-S',
          size: 'S',
          color: 'Blue',
          priceOverride: 3690,
          status: 'active',
          inventory: { availableQty: 2 },
        },
        {
          id: 102,
          sku: null,
          size: 'M',
          color: 'White',
          priceOverride: null,
          status: 'out-of-stock',
          inventory: { availableQty: 0 },
        },
        {
          id: 103,
          sku: 'HB-0042-OLD',
          size: 'L',
          color: 'Black',
          status: 'archived',
          inventory: { availableQty: 4 },
        },
      ],
      colorImages: [
        { color: 'Blue', imageUrl: 'https://cdn.example.com/products/blue.jpg' },
        { color: 'White', imageUrl: 'https://cdn.example.com/products/white.jpg' },
      ],
    });
    const brand = getMetaCatalogBrand('happybuy')!;
    const products = buildMetaCatalogProducts(item, brand);
    const rows = mapProductToMetaCatalogRows(item, brand);

    assert.equal(products.length, 2);
    assert.equal(products[0].retailerId, 'HB-0042-BLU-S');
    assert.equal(products[0].itemGroupId, 'HB-0042');
    assert.equal(products[0].price, 3690);
    assert.equal(products[0].imageUrl, 'https://cdn.example.com/products/blue.jpg');
    assert.equal(products[0].availability, 'in stock');
    assert.equal(products[0].size, 'S');
    assert.equal(products[0].color, 'Blue');
    assert.equal(products[1].retailerId, 'HB-0042-V102');
    assert.equal(products[1].price, 3490);
    assert.equal(products[1].availability, 'out of stock');
    assert.equal(rows[1].item_group_id, 'HB-0042');
    assert.equal(rows[1].size, 'M');
    assert.equal(rows[1].color, 'White');
  });

  test('bounds Meta text fields and replaces overlong unstable IDs deterministically', () => {
    const item = product({
      sku: 'X'.repeat(140),
      name: 'N'.repeat(240),
      style: 'S'.repeat(10_100),
    });
    const mapped = buildMetaCatalogProduct(item, getMetaCatalogBrand('happybuy')!);
    assert.ok(mapped);
    assert.equal(mapped.retailerId, 'PRODUCT-42');
    assert.equal(Array.from(mapped.title).length, 200);
    assert.equal(Array.from(mapped.description).length, 9_999);
  });
});

describe('Meta catalog CSV', () => {
  test('escapes commas, quotes, and line breaks according to CSV rules', () => {
    assert.equal(escapeCsvCell('Plain value'), 'Plain value');
    assert.equal(escapeCsvCell('Blue, White'), '"Blue, White"');
    assert.equal(escapeCsvCell('The "Everyday" Dress'), '"The ""Everyday"" Dress"');
    assert.equal(escapeCsvCell('Line one\nLine two'), '"Line one\nLine two"');
  });

  test('returns a header-only document for an empty catalog', () => {
    assert.equal(
      buildMetaCatalogCsv([]),
      'id,title,description,availability,condition,price,link,image_link,brand,item_group_id,color,size\r\n',
    );
  });

  test('serializes mapped rows in the declared Meta column order', () => {
    const row = mapProductToMetaCatalogRow(product(), getMetaCatalogBrand('happybuy')!);
    assert.ok(row);
    const csv = buildMetaCatalogCsv([row]);
    const lines = csv.split('\r\n');

    assert.equal(lines[0], 'id,title,description,availability,condition,price,link,image_link,brand,item_group_id,color,size');
    assert.match(lines[1], /^HB-0042,Linen Day Dress,/);
    assert.match(lines[1], /,in stock,new,3490\.00 LKR,/);
  });
});
