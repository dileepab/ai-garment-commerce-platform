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
  assert.match(decodeURIComponent(link!), /interested in HAP-0002 \(Tie-Strap Smocked Sundress\)/);
});

test('a multi-product post gets a plain opener instead of a misleading code', () => {
  const link = buildWhatsAppOrderLink({ displayPhoneNumber: '94702694270' });

  assert.match(decodeURIComponent(link!), /saw your post/);
  assert.doesNotMatch(decodeURIComponent(link!), /interested in [A-Z]{3}-/);
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
