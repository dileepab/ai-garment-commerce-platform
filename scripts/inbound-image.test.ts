import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInboundImageKey,
  inboundImageExtension,
  isFetchableImageUrl,
  parseImageDataUrl,
} from '../src/lib/chat/inbound-image.ts';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('a WhatsApp data URL is split into type and payload', () => {
  assert.deepEqual(parseImageDataUrl(JPEG), {
    mimeType: 'image/jpeg',
    base64: '/9j/4AAQSkZJRg==',
  });
});

// Base64 arrives wrapped across lines from some encoders.
test('a wrapped payload is still read', () => {
  const parsed = parseImageDataUrl('data:image/png;base64,iVBORw0KGgo=\nAAAANSUhEUgAA');
  assert.equal(parsed?.mimeType, 'image/png');
  assert.match(parsed?.base64 ?? '', /iVBORw0KGgo=/);
});

/**
 * Anything that is not an image data URL must be rejected rather than stored.
 * A non-image data URL is the one worth naming: uploading it would put
 * arbitrary bytes on a public URL under our own domain.
 */
test('non-images and malformed values are refused', () => {
  for (const value of [
    null,
    undefined,
    '',
    '   ',
    'https://example.com/photo.jpg',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/jpeg;base64,',
    'data:image/jpeg,notbase64',
  ]) {
    assert.equal(parseImageDataUrl(value), null, `${String(value)} should be refused`);
  }
});

test('the extension follows the mime type', () => {
  assert.equal(inboundImageExtension('image/jpeg'), 'jpg');
  assert.equal(inboundImageExtension('image/png'), 'png');
  assert.equal(inboundImageExtension('image/webp'), 'webp');
  assert.equal(inboundImageExtension('image/svg+xml'), 'svg');
  assert.equal(inboundImageExtension('image/jpeg; charset=binary'), 'jpg');
});

// A missing or odd type must not become part of the storage path.
test('an unusable mime type falls back rather than shaping the key', () => {
  assert.equal(inboundImageExtension(null), 'jpg');
  assert.equal(inboundImageExtension('nonsense'), 'jpg');
  assert.equal(inboundImageExtension('image/../../etc/passwd'), 'jpg');
});

test('the key is namespaced by channel and carries the extension', () => {
  assert.equal(
    buildInboundImageKey({
      channel: 'whatsapp',
      mimeType: 'image/jpeg',
      now: 1786000000000,
      random: 'ab12cd',
    }),
    'chat/whatsapp/1786000000000-ab12cd.jpg'
  );
});

// Two customers can send a photo in the same millisecond.
test('keys differ within the same millisecond', () => {
  const a = buildInboundImageKey({ channel: 'whatsapp', now: 1, random: 'aaaaaa' });
  const b = buildInboundImageKey({ channel: 'whatsapp', now: 1, random: 'bbbbbb' });
  assert.notEqual(a, b);
});

test('a hostile channel name cannot escape the chat prefix', () => {
  const key = buildInboundImageKey({
    channel: '../../secrets',
    mimeType: 'image/png',
    now: 5,
    random: 'zz',
  });

  assert.match(key, /^chat\/[a-z0-9_-]+\/5-zz\.png$/);
  assert.doesNotMatch(key, /\.\./);
});

test('http links are recognised as re-fetchable, data URLs are not', () => {
  assert.equal(isFetchableImageUrl('https://cdn.meta.com/a.jpg'), true);
  assert.equal(isFetchableImageUrl('http://cdn.meta.com/a.jpg'), true);
  assert.equal(isFetchableImageUrl(JPEG), false);
  assert.equal(isFetchableImageUrl(null), false);
});
