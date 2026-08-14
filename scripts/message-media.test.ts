import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeMessageImages,
  encodeMessageImages,
  transcriptTextFor,
} from '../src/lib/chat/message-media.ts';

const A = 'https://blob.example/a.jpg';
const B = 'https://blob.example/b.jpg';

test('a list round-trips in order', () => {
  const encoded = encodeMessageImages([A, B]);
  assert.deepEqual(decodeMessageImages(encoded), [A, B]);
});

// The first image is the one the reply is written about.
test('order is preserved, not sorted', () => {
  assert.deepEqual(decodeMessageImages(encodeMessageImages([B, A])), [B, A]);
});

test('blanks and duplicates are dropped', () => {
  assert.deepEqual(decodeMessageImages(encodeMessageImages([A, null, undefined, '  ', A, B])), [A, B]);
});

test('nothing to store is null rather than an empty array', () => {
  assert.equal(encodeMessageImages([]), null);
  assert.equal(encodeMessageImages([null, undefined, '   ']), null);
});

/**
 * Rows written before the list existed hold a bare URL in the single-image
 * column. Those conversations are a day old and must keep rendering.
 */
test('a pre-list row still reads', () => {
  assert.deepEqual(decodeMessageImages(null, A), [A]);
  assert.deepEqual(decodeMessageImages(undefined, A), [A]);
  assert.deepEqual(decodeMessageImages('', A), [A]);
});

test('the list wins over the single fallback', () => {
  assert.deepEqual(decodeMessageImages(encodeMessageImages([A, B]), 'https://blob.example/old.jpg'), [A, B]);
});

// A malformed row must not take the whole thread down with it.
test('unparseable stored values degrade quietly', () => {
  assert.deepEqual(decodeMessageImages('[not json', null), []);
  assert.deepEqual(decodeMessageImages('[not json', A), [A]);
  assert.deepEqual(decodeMessageImages('{"a":1}', null), []);
  assert.deepEqual(decodeMessageImages('[1, 2, null]', null), []);
});

test('a bare URL stored directly is treated as one image', () => {
  assert.deepEqual(decodeMessageImages(A), [A]);
});

test('no images at all is an empty list', () => {
  assert.deepEqual(decodeMessageImages(null, null), []);
});

/**
 * The customer sent a photo and no words. "What is this item?" is invented by
 * the normalizer so the router has something to classify — recording it made
 * the transcript quote words they never typed.
 */
test('an invented question is not recorded as the customer speaking', () => {
  assert.equal(
    transcriptTextFor({ routedText: 'What is this item?', wasInferred: true }),
    ''
  );
});

test('what they actually typed is recorded unchanged', () => {
  assert.equal(
    transcriptTextFor({ routedText: 'mata meka one', wasInferred: false }),
    'mata meka one'
  );
  // A caption that happens to match the invented wording is still theirs.
  assert.equal(
    transcriptTextFor({ routedText: 'What is this item?', wasInferred: false }),
    'What is this item?'
  );
});
