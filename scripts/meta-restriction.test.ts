import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectMessagingRestriction,
  isRestrictionActive,
  restrictionCooldownUntil,
  RESTRICTION_COOLDOWN_MS,
} from '../src/lib/meta-restriction.ts';

// The real payload that took two weeks to identify on the Happybuy Page.
const RESTRICTED = {
  error: {
    message: 'Application does not have permission for this action',
    code: 10,
    error_subcode: 1893063,
    error_user_msg:
      'You are temporarily restricted from sending messages.  Learn more about when and why we restrict messaging.',
    fbtrace_id: 'AhVnpUyQouFNpk0jh2jEoXj',
  },
};

test('the messaging restriction is recognised by its subcode', () => {
  const signal = detectMessagingRestriction(RESTRICTED);

  assert.equal(signal.restricted, true);
  assert.match(signal.reason!, /temporarily restricted from sending messages/);
  assert.match(signal.reason!, /subcode 1893063/);
});

test('the restriction is still recognised when only the wording is present', () => {
  const signal = detectMessagingRestriction({
    error: {
      message: 'You are temporarily restricted from sending messages.',
      code: 10,
    },
  });

  assert.equal(signal.restricted, true);
});

// Meta reuses this sentence across unrelated causes, which is exactly what made
// the original diagnosis take four wrong turns. It must not match on its own.
test('the generic permission message alone is not a restriction', () => {
  const signal = detectMessagingRestriction({
    error: {
      message: 'Application does not have permission for this action',
      code: 200,
      error_subcode: 2018028,
    },
  });

  assert.equal(signal.restricted, false);
});

test('an expired token is not mistaken for a restriction', () => {
  assert.equal(
    detectMessagingRestriction({ error: { message: 'Error validating access token', code: 190 } })
      .restricted,
    false
  );
});

test('a successful payload is not a restriction', () => {
  assert.equal(detectMessagingRestriction({ message_id: 'm_1' }).restricted, false);
  assert.equal(detectMessagingRestriction(null).restricted, false);
});

test('a cooldown in the future is active and one in the past is not', () => {
  const now = new Date('2026-08-07T10:00:00Z');

  assert.equal(isRestrictionActive(new Date('2026-08-07T10:05:00Z'), now), true);
  assert.equal(isRestrictionActive(new Date('2026-08-07T09:55:00Z'), now), false);
  assert.equal(isRestrictionActive(null, now), false);
  assert.equal(isRestrictionActive(undefined, now), false);
});

test('a cooldown stored as a string is honoured', () => {
  const now = new Date('2026-08-07T10:00:00Z');

  assert.equal(isRestrictionActive('2026-08-07T10:05:00Z', now), true);
  assert.equal(isRestrictionActive('not a date', now), false);
});

test('the cooldown probes again rather than sitting out a guessed duration', () => {
  const now = new Date('2026-08-07T10:00:00Z');
  const until = restrictionCooldownUntil(now);

  assert.equal(until.getTime() - now.getTime(), RESTRICTION_COOLDOWN_MS);
  assert.ok(RESTRICTION_COOLDOWN_MS <= 60 * 60 * 1000, 'cooldown should stay under an hour');
});
