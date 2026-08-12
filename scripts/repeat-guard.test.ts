import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendRepeatNudge,
  isUnhelpfulRepeat,
  REPEAT_NUDGE,
} from '../src/lib/chat/repeat-guard.ts';

const SPEC_DUMP = [
  'Tie-Strap Smocked Sundress — Blue Grey fit/details:',
  'Fabric: Cheesecloth',
  'Garment length: 84 cm',
  'Worn length: Above knee',
  'Item code: HAP-0001',
].join('\n');

/**
 * The conversation this exists for. Asked "will this be alright to wear out?",
 * the bot sent back the identical spec sheet it had just sent, and an agent had
 * to step in an hour later to answer in one line.
 */
test('the same answer twice in a row is caught', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: SPEC_DUMP,
      previousReply: SPEC_DUMP,
      assistantReplyKind: 'generic',
    }),
    true
  );
});

// "Hi" and "Mis" both drew the byte-identical greeting.
test('a repeated greeting is caught', () => {
  const greeting = 'Hello business. How can I help you with Happybuy today?';

  assert.equal(
    isUnhelpfulRepeat({
      reply: greeting,
      previousReply: greeting,
      assistantReplyKind: 'greeting',
    }),
    true
  );
});

test('spacing and case do not disguise a repeat', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: 'Available  sizes:  S, M, L',
      previousReply: 'available sizes: S, M, L',
      assistantReplyKind: 'generic',
    }),
    true
  );
});

test('a genuinely different answer is left alone', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: 'It sits above the knee, so it should be fine for that.',
      previousReply: SPEC_DUMP,
      assistantReplyKind: 'generic',
    }),
    false
  );
});

/**
 * Asking again for something the customer has not yet given is the point, not a
 * bug — the contact re-ask was a deliberate fix and must survive this guard.
 */
test('deliberate re-prompts are allowed to repeat', () => {
  const prompt = 'What is your phone number?';

  for (const kind of ['contact_confirmation', 'quantity_prompt', 'order_summary'] as const) {
    assert.equal(
      isUnhelpfulRepeat({ reply: prompt, previousReply: prompt, assistantReplyKind: kind }),
      false,
      `${kind} should be allowed to repeat`
    );
  }
});

test('support replies may repeat while a customer waits', () => {
  const holding = 'Our team will get back to you shortly.';

  assert.equal(
    isUnhelpfulRepeat({
      reply: holding,
      previousReply: holding,
      assistantReplyKind: 'support_waiting',
    }),
    false
  );
});

// A first reply has nothing to repeat, and a silent turn is not a repeat.
test('nothing to compare against is not a repeat', () => {
  assert.equal(
    isUnhelpfulRepeat({ reply: 'Hello', previousReply: null, assistantReplyKind: 'greeting' }),
    false
  );
  assert.equal(
    isUnhelpfulRepeat({ reply: null, previousReply: 'Hello', assistantReplyKind: 'greeting' }),
    false
  );
  assert.equal(
    isUnhelpfulRepeat({ reply: '   ', previousReply: 'Hello', assistantReplyKind: 'greeting' }),
    false
  );
});

/**
 * The answer is kept. Replacing it threw away correct information — the
 * regression suite caught an empty-catalog reply being swallowed, and a
 * customer who asks the same thing twice deserves the same answer.
 */
test('the answer survives and the ask is added', () => {
  const nudged = appendRepeatNudge(SPEC_DUMP);

  assert.match(nudged, /Item code: HAP-0001/);
  assert.match(nudged, /Above knee/);
  assert.match(nudged, /size|colour|wear/i);
});

test('a nudge is never stacked on itself', () => {
  const nudged = appendRepeatNudge(SPEC_DUMP);

  assert.equal(
    isUnhelpfulRepeat({
      reply: nudged,
      previousReply: SPEC_DUMP,
      assistantReplyKind: 'generic',
    }),
    false
  );
  assert.equal(nudged.split(REPEAT_NUDGE).length - 1, 1);
});

// A third identical answer must still be caught, even though the reply it is
// being compared against now carries a nudge.
test('a repeat is still caught when the previous reply was already nudged', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: SPEC_DUMP,
      previousReply: appendRepeatNudge(SPEC_DUMP),
      assistantReplyKind: 'generic',
    }),
    true
  );
});
