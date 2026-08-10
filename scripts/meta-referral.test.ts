import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReferralMessage,
  normalizeMessengerEvent,
} from '../src/lib/meta-normalize.ts';

const PAGE_ID = '1078757381992224';
const SENDER = { id: '24680' };

// A customer who already has a thread taps m.me/happybuy?ref=HAP-0001. Meta
// sends this — no message, no postback, just where they came from.
test('a returning customer arriving from a link opens the conversation', () => {
  const normalized = normalizeMessengerEvent(
    {
      sender: SENDER,
      timestamp: 1786300000000,
      referral: { ref: 'HAP-0001', source: 'SHORTLINK', type: 'OPEN_THREAD' },
    },
    PAGE_ID
  );

  assert.ok(normalized, 'a referral must not be dropped as unsupported');
  assert.equal(normalized.messageText, 'Order HAP-0001');
  assert.equal(normalized.senderId, '24680');
  assert.equal(normalized.channel, 'messenger');
  assert.equal(normalized.pageOrAccountId, PAGE_ID);
  // Routed as a normal message so the item code resolves the product; the
  // postback path is for payloads we authored ourselves.
  assert.equal(normalized.isPostback, false);
});

// A first-ever contact taps Get Started instead, and the ref rides along.
test('a first-time customer carries the ref on the postback', () => {
  const normalized = normalizeMessengerEvent(
    {
      sender: SENDER,
      timestamp: 1786300000000,
      postback: {
        mid: 'mid.abc',
        title: 'Get Started',
        payload: 'GET_STARTED',
        referral: { ref: 'HAP-0002', source: 'SHORTLINK', type: 'OPEN_THREAD' },
      },
    },
    PAGE_ID
  );

  assert.ok(normalized);
  assert.match(normalized.messageText, /HAP-0002/);
});

test('a referral gets a stable event id so a retry is not processed twice', () => {
  const event = {
    sender: SENDER,
    timestamp: 1786300000000,
    referral: { ref: 'HAP-0001', source: 'SHORTLINK' },
  };

  const first = normalizeMessengerEvent(event, PAGE_ID);
  const second = normalizeMessengerEvent(event, PAGE_ID);

  assert.ok(first?.eventId);
  assert.equal(first.eventId, second?.eventId);
  assert.match(first.eventId, /referral/);
});

test('two different refs are different events', () => {
  const base = { sender: SENDER, timestamp: 1786300000000 };
  const one = normalizeMessengerEvent({ ...base, referral: { ref: 'HAP-0001' } }, PAGE_ID);
  const two = normalizeMessengerEvent({ ...base, referral: { ref: 'HAP-0002' } }, PAGE_ID);

  assert.notEqual(one?.eventId, two?.eventId);
});

// An ordinary message must keep behaving exactly as before.
test('a referral riding along with a typed message does not replace it', () => {
  const normalized = normalizeMessengerEvent(
    {
      sender: SENDER,
      timestamp: 1786300000000,
      message: { mid: 'mid.xyz', text: 'do you have this in L?' },
      referral: { ref: 'HAP-0001', source: 'SHORTLINK' },
    },
    PAGE_ID
  );

  assert.equal(normalized?.messageText, 'do you have this in L?');
});

test('an event with neither a message nor a ref is still ignored', () => {
  assert.equal(normalizeMessengerEvent({ sender: SENDER, timestamp: 1 }, PAGE_ID), null);
  assert.equal(normalizeMessengerEvent({ timestamp: 1, referral: { ref: 'HAP-0001' } }, PAGE_ID), null);
});

test('an echo is still skipped even when a ref is attached', () => {
  const normalized = normalizeMessengerEvent(
    {
      sender: SENDER,
      message: { mid: 'mid.1', text: 'hello', is_echo: true },
      referral: { ref: 'HAP-0001' },
    },
    PAGE_ID
  );

  assert.equal(normalized, null);
});

// The ref is the item code, so it reads as an order and resolves through the
// same path as a customer typing the code.
test('a code-shaped ref becomes an order for that item', () => {
  assert.equal(buildReferralMessage('HAP-0001'), 'Order HAP-0001');
  assert.equal(buildReferralMessage('  hap-0001  '), 'Order hap-0001');
});

// An unknown ref should still start a conversation rather than be dropped.
test('a ref that is not a code is passed through', () => {
  assert.equal(buildReferralMessage('summer-sale'), 'summer-sale');
  assert.equal(buildReferralMessage('welcome'), 'welcome');
});
