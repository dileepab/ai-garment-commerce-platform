import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendWhatsAppOrderLine,
  buildWhatsAppOrderLink,
  normalizeWhatsAppNumber,
} from '../src/lib/whatsapp-order-link.ts';

test('a Sri Lankan number is reduced to digits wa.me accepts', () => {
  assert.equal(normalizeWhatsAppNumber('+94 70 269 4270'), '94702694270');
  assert.equal(normalizeWhatsAppNumber('94-70-269-4270'), '94702694270');
});

test('an unusable number yields no link rather than a broken one', () => {
  assert.equal(normalizeWhatsAppNumber('12345'), null);
  assert.equal(normalizeWhatsAppNumber(''), null);
  assert.equal(normalizeWhatsAppNumber(null), null);
  assert.equal(buildWhatsAppOrderLink({ displayPhoneNumber: null }), null);
});

// The point of prefilling: the first message already says which product, so the
// bot answers about the dress instead of asking which one.
test('the item code is prefilled into the message', () => {
  const link = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
    productName: 'Tie-Strap Smocked Sundress',
  });

  assert.match(link!, /^https:\/\/wa\.me\/94702694270\?text=/);
  assert.equal(decodeURIComponent(link!), 'https://wa.me/94702694270?text=Order HAP-0002');
});

// The name costs URL length — tripled by percent-encoding — and tells the bot
// nothing the code did not already say. It sits in the caption above anyway.
test('the product name is left out of the link', () => {
  const link = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
    productName: 'Tie-Strap Smocked Sundress — Blue Grey',
  });

  assert.doesNotMatch(decodeURIComponent(link!), /Sundress/);
  assert.ok(link!.length < 60, `link should stay short, got ${link!.length}: ${link}`);
});

/**
 * A prefill that opens with "Hi" is read as a bare greeting unless something
 * else in it carries intent, and the customer gets "Hello, how can I help?"
 * instead of an answer about the item they tapped. That is what the old
 * "Hi, I'm interested in HAP-0002 (…Sundress)" wording did whenever the product
 * name happened not to contain a garment word.
 */
test('the prefill does not open with a greeting', () => {
  const withCode = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
  });
  const withoutCode = buildWhatsAppOrderLink({ displayPhoneNumber: '94702694270' });

  const greeting = /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i;
  for (const link of [withCode, withoutCode]) {
    const message = decodeURIComponent(link!).split('?text=')[1];
    assert.doesNotMatch(message, greeting, `prefill reads as a greeting: ${message}`);
  }
});

test('a post with no known codes gets a plain opener instead of a misleading one', () => {
  const link = buildWhatsAppOrderLink({ displayPhoneNumber: '94702694270' });

  assert.match(decodeURIComponent(link!), /saw your post/);
  assert.doesNotMatch(decodeURIComponent(link!), /[A-Z]{3}-\d/);
});

/**
 * Live Happybuy multi-item posts published with "?text=I saw your post", so
 * every click on a three-dress carousel arrived saying nothing — the bot had to
 * open by asking which one, on traffic we are about to pay for.
 */
test('a multi-product post names every item it is showing', () => {
  const message = decodeURIComponent(
    buildWhatsAppOrderLink({
      displayPhoneNumber: '94702694270',
      itemCodes: ['HAP-0001', 'HAP-0002', 'HAP-0003'],
    })!
  ).split('?text=')[1];

  assert.match(message, /HAP-0001/);
  assert.match(message, /HAP-0002/);
  assert.match(message, /HAP-0003/);
});

// The bot builds multi-item orders now, so "Order HAP-0001 HAP-0002 HAP-0003"
// would put a browsing shopper straight into a three-dress draft.
test('a multi-product prefill asks about the items rather than ordering them', () => {
  const message = decodeURIComponent(
    buildWhatsAppOrderLink({
      displayPhoneNumber: '94702694270',
      itemCodes: ['HAP-0001', 'HAP-0002'],
    })!
  ).split('?text=')[1];

  assert.doesNotMatch(message, /^Order\b/);
});

test('a single code still reads as an order, whichever field carries it', () => {
  const viaList = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCodes: ['HAP-0002'],
  });
  const viaSingle = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
  });

  assert.equal(viaList, viaSingle);
  assert.match(decodeURIComponent(viaList!), /text=Order HAP-0002$/);
});

test('the same code listed twice is prefilled once', () => {
  const link = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
    itemCodes: ['HAP-0002', null, '  '],
  });

  assert.match(decodeURIComponent(link!), /text=Order HAP-0002$/);
});

// Past a handful the list stops describing the post and just bloats the URL.
test('a post with many items falls back to the plain opener', () => {
  const link = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCodes: ['HAP-0001', 'HAP-0002', 'HAP-0003', 'HAP-0004', 'HAP-0005'],
  });

  assert.match(decodeURIComponent(link!), /saw your post/);
});

/**
 * Facebook collapses a long caption behind "See more", and the generated copy
 * ends in a block of hashtags — so a link appended after them starts out hidden
 * on exactly the traffic an ad pays for.
 */
test('the order line sits above the trailing hashtags', () => {
  const caption = appendWhatsAppOrderLine(
    'Vibrant red florals meet breathable cotton comfort. 🌸✨ #HappybuySL #SummerDress #FloralDress',
    { displayPhoneNumber: '94702694270', itemCode: 'HAP-0003' }
  );

  const linkAt = caption.indexOf('Order on WhatsApp:');
  const hashtagsAt = caption.indexOf('#HappybuySL');

  assert.ok(linkAt > 0, 'the order line should be present');
  assert.ok(linkAt < hashtagsAt, `link should precede the hashtags:\n${caption}`);
  assert.match(caption, /#HappybuySL #SummerDress #FloralDress$/);
  assert.match(caption, /^Vibrant red florals/);
});

test('a caption without hashtags still gets the line at the end', () => {
  const caption = appendWhatsAppOrderLine('New arrivals.', {
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0003',
  });

  assert.match(caption, /^New arrivals\.\n\nOrder on WhatsApp: /);
});

// A hashtag inside the copy is not a trailing block and must not be split on.
test('a hashtag used mid-sentence does not move the line', () => {
  const caption = appendWhatsAppOrderLine('Our #1 bestseller is back in stock.', {
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0003',
  });

  assert.match(caption, /^Our #1 bestseller is back in stock\.\n\nOrder on WhatsApp: /);
});

test('the message is URL encoded so spaces and punctuation survive', () => {
  const link = buildWhatsAppOrderLink({
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
  });

  assert.doesNotMatch(link!, / /, 'a raw space would break the link');
  assert.match(link!, /%20/);
});

test('the order line is appended to a caption', () => {
  const caption = appendWhatsAppOrderLine('New arrivals in three colourways.', {
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
  });

  assert.match(caption, /New arrivals in three colourways\./);
  assert.match(caption, /Order on WhatsApp: https:\/\/wa\.me\/94702694270/);
});

// Regenerating a caption should not stack duplicate links.
test('a caption that already links to WhatsApp is left alone', () => {
  const existing = 'Shop now\n\nOrder on WhatsApp: https://wa.me/94702694270?text=Hi';
  const caption = appendWhatsAppOrderLine(existing, {
    displayPhoneNumber: '94702694270',
    itemCode: 'HAP-0002',
  });

  assert.equal(caption, existing);
});

test('a caption is unchanged when the brand has no WhatsApp number', () => {
  const caption = appendWhatsAppOrderLine('New arrivals.', { displayPhoneNumber: null });

  assert.equal(caption, 'New arrivals.');
});
