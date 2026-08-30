import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareTikTokCaption } from '../src/lib/tiktok-caption.ts';

const PUBLISHED_COPY = `There is nothing quite like the airy feel of light cheesecloth on a warm afternoon. Our new Tie-Strap Smocked Sundress in a dreamy Blue Grey features a beautifully textured smocked bodice and adjustable shoulder ties for the perfect fit. Slip into this effortless style for just Rs 1,990, available in sizes S to XL. 💙✨

Order on WhatsApp: https://wa.me/94714123777?text=Order%20HAP-0001

Item Name: Tie-Strap Smocked Sundress — Blue Grey
Item Code: HAP-0001
Available Sizes: S, M, L, XL
Available Colors: Blue Grey
Item Price: Rs 1,990`;

test('removes the internal catalogue block from a TikTok caption', () => {
  const caption = prepareTikTokCaption(PUBLISHED_COPY);

  assert.match(caption, /^There is nothing quite like/);
  assert.match(caption, /Order on WhatsApp:/);
  assert.doesNotMatch(caption, /Item Name:/);
  assert.doesNotMatch(caption, /Available Sizes:/);
  assert.doesNotMatch(caption, /Item Price:/);
});

test('also removes the block when TikTok displays the caption as one line', () => {
  const caption = prepareTikTokCaption(PUBLISHED_COPY.replace(/\n+/g, ' '));

  assert.match(caption, /Order%20HAP-0001$/);
  assert.doesNotMatch(caption, /Item Code:/);
});

test('preserves intentional public copy and a standalone item code', () => {
  const caption = 'Blue Grey is here 💙\n\nAsk for Item Code: HAP-0001\n\n#HappyBuyLK #Sundress';

  assert.equal(prepareTikTokCaption(caption), caption);
});

test('normalizes excess blank lines without flattening the caption', () => {
  assert.equal(prepareTikTokCaption('Hook\n\n\n\nShop now'), 'Hook\n\nShop now');
});

const PRODUCT_DESCRIPTION = [
  'Item Name: Tie-Strap Smocked Sundress — Blue Grey',
  'Item Code: HAP-0002',
  'Available Sizes: S, M, L, XL',
  'Available Colors: Blue Grey',
  'Item Price: Rs 1,990',
].join('\n');

test('adds verified sizes and price before the WhatsApp CTA', () => {
  const caption = prepareTikTokCaption(
    'Your summer dress is here 💙\n\nOrder on WhatsApp: https://wa.me/94714123777\n\n#Happybuy #SummerDress',
    [PRODUCT_DESCRIPTION],
  );

  assert.equal(caption, [
    'Your summer dress is here 💙',
    '',
    'Available sizes: S, M, L, XL',
    'Price: Rs 1,990',
    '',
    'Order on WhatsApp: https://wa.me/94714123777',
    '',
    '#Happybuy #SummerDress',
  ].join('\n'));
});

test('replaces stale generated facts with current product values', () => {
  const caption = prepareTikTokCaption(
    'Just landed ✨\n\nAvailable sizes: S, M\nPrice: Rs 1,790\n\n#Happybuy',
    [PRODUCT_DESCRIPTION],
  );

  assert.equal(caption.match(/Available sizes:/g)?.length, 1);
  assert.equal(caption.match(/Price:/g)?.length, 1);
  assert.match(caption, /Available sizes: S, M, L, XL/);
  assert.match(caption, /Price: Rs 1,990/);
  assert.doesNotMatch(caption, /1,790/);
});

test('lists size and price by item code for a multi-product TikTok post', () => {
  const second = PRODUCT_DESCRIPTION
    .replace('HAP-0002', 'HAP-0003')
    .replace('S, M, L, XL', 'M, L')
    .replace('Rs 1,990', 'Rs 2,490');
  const caption = prepareTikTokCaption('Two new looks ✨\n\n#Happybuy', [PRODUCT_DESCRIPTION, second]);

  assert.match(caption, /HAP-0002 — Sizes: S, M, L, XL · Price: Rs 1,990/);
  assert.match(caption, /HAP-0003 — Sizes: M, L · Price: Rs 2,490/);
  assert.match(caption, /#Happybuy$/);
});
