import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendItemDescriptions,
  buildItemDescription,
  postItemCode,
} from '../src/lib/post-item-details.ts';

const SUNDRESS = {
  id: 1,
  sku: null,
  brand: 'Happybuy',
  name: 'Tie-Strap Smocked Sundress — Blue Grey',
  price: 1990,
  sizes: 'S,M,L,XL',
  colors: 'Blue Grey',
  variants: [],
};

const LINEN_PANTS = {
  id: 4,
  sku: null,
  brand: 'Happybuy',
  name: 'Relaxed Linen Pants',
  price: 2500,
  sizes: 'M,L',
  colors: 'Beige',
  variants: [],
};

test('an item block reads exactly as it does on the post', () => {
  assert.equal(
    buildItemDescription({ product: SUNDRESS }),
    [
      'Item Name: Tie-Strap Smocked Sundress — Blue Grey',
      'Item Code: HAP-0001',
      'Available Sizes: S, M, L, XL',
      'Available Colors: Blue Grey',
      'Item Price: Rs 1,990',
    ].join('\n')
  );
});

test('a stored SKU is preferred over the derived code', () => {
  assert.equal(postItemCode({ ...SUNDRESS, sku: 'HAP-CUSTOM' }), 'HAP-CUSTOM');
  assert.equal(postItemCode(SUNDRESS), 'HAP-0001');
});

// The shopper stops on one photo in a carousel of three. That photo has to say
// what the item is, because the caption below is describing all of them.
test('each photo carries the details of its own item', () => {
  const first = buildItemDescription({ product: SUNDRESS });
  const second = buildItemDescription({ product: LINEN_PANTS });

  assert.match(first, /Item Code: HAP-0001/);
  assert.match(second, /Item Code: HAP-0004/);
  assert.match(second, /Item Price: Rs 2,500/);
  assert.notEqual(first, second);
});

test('the caption lists every item in a multi-item post', () => {
  const caption = appendItemDescriptions('New arrivals this week.', [
    buildItemDescription({ product: SUNDRESS }),
    buildItemDescription({ product: LINEN_PANTS }),
  ]);

  assert.match(caption, /^New arrivals this week\./);
  assert.match(caption, /Item Code: HAP-0001/);
  assert.match(caption, /Item Code: HAP-0004/);
});

// Several angles of one dress share its details; repeating the block once per
// photo would read like a bug.
test('repeated items are listed once', () => {
  const block = buildItemDescription({ product: SUNDRESS });
  const caption = appendItemDescriptions('Three angles.', [block, block, block]);

  assert.equal(caption.match(/Item Name:/g)?.length, 1);
});

test('a caption that already carries details is not given them twice', () => {
  const once = appendItemDescriptions('Shop now.', [buildItemDescription({ product: SUNDRESS })]);
  const twice = appendItemDescriptions(once, [buildItemDescription({ product: SUNDRESS })]);

  assert.equal(twice, once);
});

test('a caption with no usable details is left as written', () => {
  assert.equal(appendItemDescriptions('Just vibes.', []), 'Just vibes.');
  assert.equal(appendItemDescriptions('Just vibes.', ['', '  ', 'N/A']), 'Just vibes.');
});

// Creatives predating the product link should still publish with what is known
// rather than a block of "N/A".
test('details fall back to the context captured while drafting', () => {
  const description = buildItemDescription({
    productContext: 'Name: Ribbed Crop Top. Sizes: S,M. Colors: Black. Price: Rs 1,450.',
  });

  assert.match(description, /Item Name: Ribbed Crop Top/);
  assert.match(description, /Available Sizes: S, M/);
  assert.match(description, /Item Price: Rs 1,450/);
});

test('nothing known at all falls back to the stored description', () => {
  assert.equal(
    buildItemDescription({ fallbackDescription: 'Blue dress on a beach' }),
    'Blue dress on a beach'
  );
  assert.equal(buildItemDescription({ fallbackDescription: 'N/A' }), '');
  assert.equal(buildItemDescription({}), '');
});

// "L,M,S,XL" went out on a live Happybuy post. Sizes are typed by hand, so the
// stored order means nothing.
test('sizes publish smallest to largest whatever order they were entered in', () => {
  assert.match(
    buildItemDescription({ product: { ...SUNDRESS, sizes: 'L,M,S,XL' } }),
    /Available Sizes: S, M, L, XL/
  );
  assert.match(
    buildItemDescription({ product: { ...SUNDRESS, sizes: 'XXL, XS, M' } }),
    /Available Sizes: XS, M, XXL/
  );
  assert.match(
    buildItemDescription({ product: { ...SUNDRESS, sizes: '3XL/S/2XL' } }),
    /Available Sizes: S, 2XL, 3XL/
  );
});

test('numeric sizes sort as numbers, not as text', () => {
  assert.match(
    buildItemDescription({ product: { ...SUNDRESS, sizes: '32,8,10,28' } }),
    /Available Sizes: 8, 10, 28, 32/
  );
});

// A size we do not recognise is worth less than a size we silently drop.
test('an unrecognised size is kept, at the end', () => {
  assert.match(
    buildItemDescription({ product: { ...SUNDRESS, sizes: 'Free Size, M, S' } }),
    /Available Sizes: S, M, Free Size/
  );
});

test('a size listed twice is printed once', () => {
  assert.match(
    buildItemDescription({ product: { ...SUNDRESS, sizes: 'M, m , L' } }),
    /Available Sizes: M, L/
  );
});

// Three colourways of one dress are three products, so they rendered as three
// blocks differing only in colour and code.
test('colourways of one style collapse into a single block', () => {
  const caption = appendItemDescriptions('New in.', [
    buildItemDescription({ product: SUNDRESS }),
    buildItemDescription({
      product: { ...SUNDRESS, id: 2, name: 'Tie-Strap Smocked Sundress — Cream Red Floral', colors: 'Cream Red Floral' },
    }),
    buildItemDescription({
      product: { ...SUNDRESS, id: 3, name: 'Tie-Strap Smocked Sundress — Red Floral', colors: 'Red Floral', sizes: 'L,M,S,XL' },
    }),
  ]);

  assert.equal(caption.match(/Item Name:/g)?.length, 1);
  assert.match(caption, /Item Name: Tie-Strap Smocked Sundress\n/);
  // Every code survives, so a shopper can still order the exact colour.
  assert.match(caption, /Blue Grey \(HAP-0001\)/);
  assert.match(caption, /Cream Red Floral \(HAP-0002\)/);
  assert.match(caption, /Red Floral \(HAP-0003\)/);
  assert.match(caption, /Item Price: Rs 1,990/);
});

test('items that differ in price are not merged', () => {
  const caption = appendItemDescriptions('New in.', [
    buildItemDescription({ product: SUNDRESS }),
    buildItemDescription({
      product: { ...SUNDRESS, id: 2, name: 'Tie-Strap Smocked Sundress — Red Floral', colors: 'Red Floral', price: 2490 },
    }),
  ]);

  assert.equal(caption.match(/Item Name:/g)?.length, 2);
  assert.match(caption, /Item Price: Rs 1,990/);
  assert.match(caption, /Item Price: Rs 2,490/);
});

test('a free-text description is passed through unmerged', () => {
  const caption = appendItemDescriptions('New in.', [
    'Blue dress on a beach',
    buildItemDescription({ product: SUNDRESS }),
  ]);

  assert.match(caption, /Blue dress on a beach/);
  assert.match(caption, /Item Code: HAP-0001/);
});

test('a price that is missing does not print as a number', () => {
  const description = buildItemDescription({
    product: { ...SUNDRESS, price: Number.NaN },
  });

  assert.match(description, /Item Price: N\/A/);
});
