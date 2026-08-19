import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEmojiOnlyMessage } from '../src/lib/chat/acknowledgement.ts';

test('a bare emoji is recognised, including skin tones and composed ones', () => {
  // The message from the production inbox that started this.
  assert.equal(isEmojiOnlyMessage('👍🏽'), true);
  assert.equal(isEmojiOnlyMessage('👍'), true);
  assert.equal(isEmojiOnlyMessage('❤️'), true);
  assert.equal(isEmojiOnlyMessage('🙏🏾'), true);
  assert.equal(isEmojiOnlyMessage('😊😊'), true);
  assert.equal(isEmojiOnlyMessage('  👌  '), true);
  assert.equal(isEmojiOnlyMessage('👨‍👩‍👧'), true);
});

test('anything carrying words is left to the normal intent matching', () => {
  assert.equal(isEmojiOnlyMessage('ok 👍'), false);
  assert.equal(isEmojiOnlyMessage('👍 send me the price'), false);
  assert.equal(isEmojiOnlyMessage('Red dress pictures'), false);
  assert.equal(isEmojiOnlyMessage('ස්තුතියි'), false);
});

test('digits are not emoji, even though they are emoji components', () => {
  // \p{Emoji_Component} covers ASCII digits and "#" for keycap sequences, so
  // matching on it would swallow an order number.
  assert.equal(isEmojiOnlyMessage('123'), false);
  assert.equal(isEmojiOnlyMessage('#1234'), false);
  assert.equal(isEmojiOnlyMessage('0775314892'), false);
});

test('an empty or punctuation-only message is not an acknowledgement', () => {
  assert.equal(isEmojiOnlyMessage(''), false);
  assert.equal(isEmojiOnlyMessage('   '), false);
  assert.equal(isEmojiOnlyMessage('...'), false);
  assert.equal(isEmojiOnlyMessage('?'), false);
});
