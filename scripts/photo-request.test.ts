import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikePhotoRequest } from '../src/lib/chat/photo-request.ts';

/**
 * The messages that were arriving with four photographs attached. They are
 * questions about the record, not requests to see the item.
 */
test('a question about the item is not a request to see it', () => {
  for (const message of [
    'What is the fabric of the skort?',
    'Price',
    'What is the price?',
    'Is HAP-0005 available?',
    'What colors does it come in?',
    'S size',
    'Do you deliver to Kandy?',
  ]) {
    assert.equal(looksLikePhotoRequest(message), false, message);
  }
});

test('asking for a photograph is recognised', () => {
  for (const message of [
    'Can you send a photo?',
    'I want Photo of HAP-0005',
    'send pics please',
    'Any images of this?',
    'send me a picture',
  ]) {
    assert.equal(looksLikePhotoRequest(message), true, message);
  }
});

test('asking to see the item counts, even without the word photo', () => {
  assert.equal(looksLikePhotoRequest('can I see it?'), true);
  assert.equal(looksLikePhotoRequest('show me this dress'), true);
  assert.equal(looksLikePhotoRequest('how does it look'), true);
});

// Romanised Sinhala and Tamil that turn up in this inbox.
test('local phrasing for send and show is recognised', () => {
  assert.equal(looksLikePhotoRequest('photo ewanna'), true);
  assert.equal(looksLikePhotoRequest('pennanna'), true);
  assert.equal(looksLikePhotoRequest('anuppunga'), true);
});

/**
 * The size chart is its own reply with its own image. Asking for one must not
 * drag the product photographs along too.
 */
test('a size chart request does not pull product photos', () => {
  assert.equal(looksLikePhotoRequest('Can I get a size chart for reference?'), false);
  assert.equal(looksLikePhotoRequest('send me size chart of skort'), false);
  // Unless they explicitly asked for a photo as well.
  assert.equal(looksLikePhotoRequest('size chart and a photo please'), true);
});

test('empty input is not a request', () => {
  assert.equal(looksLikePhotoRequest(''), false);
  assert.equal(looksLikePhotoRequest('   '), false);
});
