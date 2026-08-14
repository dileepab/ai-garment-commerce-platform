import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendRepeatHandover,
  isUnhelpfulRepeat,
  REPEAT_HANDOVER_MESSAGE,
} from '../src/lib/chat/repeat-guard.ts';

const SPEC_DUMP = [
  'Tie-Strap Smocked Sundress — Blue Grey fit/details:',
  'Fabric: Cheesecloth',
  'Garment length: 84 cm',
  'Worn length: Above knee',
  'Item code: HAP-0001',
].join('\n');

/**
 * The bot has already said it did not understand. Saying it a second time is
 * the point at which it is demonstrably stuck and a person should take over.
 */
test('a fallback repeated is treated as stuck', () => {
  const fallback = "Sorry, I didn't quite catch that. Could you rephrase?";

  assert.equal(
    isUnhelpfulRepeat({
      reply: fallback,
      previousReply: fallback,
      assistantReplyKind: 'fallback',
    }),
    true
  );
});

/**
 * The regression suite asks for the catalog four different ways and rightly
 * expects the catalog four times. Repeating a good answer is not failure, and
 * escalating on it took a passing suite down to twelve cases.
 */
test('a correct answer repeated is not an escalation', () => {
  const catalog = 'Oversized Casual Top — Rs 1,750\nBreezy Summer Dress — Rs 2,950';

  for (const kind of ['generic', 'greeting', 'order_status'] as const) {
    assert.equal(
      isUnhelpfulRepeat({ reply: catalog, previousReply: catalog, assistantReplyKind: kind }),
      false,
      `${kind} repeated should not escalate`
    );
  }
});

/**
 * Deliberately out of scope. In the sundress conversation the bot believed it
 * had answered and re-sent a spec sheet to a different question — telling that
 * apart from a legitimate repeat needs to know whether the reply addressed the
 * question, which this cannot judge.
 */
test('a confident wrong answer repeated is not caught here', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: SPEC_DUMP,
      previousReply: SPEC_DUMP,
      assistantReplyKind: 'generic',
    }),
    false
  );
});

test('spacing and case do not disguise a repeat', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: 'Available  sizes:  S, M, L',
      previousReply: 'available sizes: S, M, L',
      assistantReplyKind: 'fallback',
    }),
    true
  );
});

test('a genuinely different answer is left alone', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: 'It sits above the knee, so it should be fine for that.',
      previousReply: SPEC_DUMP,
      assistantReplyKind: 'fallback',
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
test('the answer survives and the handover is added', () => {
  const handed = appendRepeatHandover(SPEC_DUMP);

  assert.match(handed, /Item code: HAP-0001/);
  assert.match(handed, /Above knee/);
  assert.match(handed, /someone from our team/i);
});

// It keeps the customer in this thread rather than sending them to a phone
// number, because the thread is where the support inbox picks the case up.
test('the handover promises a person in this thread', () => {
  assert.match(REPEAT_HANDOVER_MESSAGE, /reply here/i);
  assert.doesNotMatch(REPEAT_HANDOVER_MESSAGE, /\d{7,}/);
});

test('a handover is never stacked on itself', () => {
  const handed = appendRepeatHandover(SPEC_DUMP);

  assert.equal(
    isUnhelpfulRepeat({
      reply: handed,
      previousReply: SPEC_DUMP,
      assistantReplyKind: 'fallback',
    }),
    false
  );
  assert.equal(handed.split(REPEAT_HANDOVER_MESSAGE).length - 1, 1);
});

test('a repeat is still caught when the previous reply already handed over', () => {
  assert.equal(
    isUnhelpfulRepeat({
      reply: SPEC_DUMP,
      previousReply: appendRepeatHandover(SPEC_DUMP),
      assistantReplyKind: 'fallback',
    }),
    true
  );
});
