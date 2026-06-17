import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getInstagramBusinessLoopSkipReason,
  getInstagramInternalSenderIdsForBrand,
  getMessengerBusinessLoopSkipReason,
  getMessengerInternalSenderIdsForBrand,
  getWebhookMessageTextForLoopGuard,
  getWebhookSenderId,
  isManagedInstagramAutoReplyText,
} from '../src/lib/meta-loop-guard.ts';

test('detects managed Instagram greeting auto-replies', () => {
  assert.equal(isManagedInstagramAutoReplyText('Hello. How can I help you with Cleopatra today?'), true);
  assert.equal(isManagedInstagramAutoReplyText('Hello Nisha. How can I help you with Happybuy today?'), true);
  assert.equal(isManagedInstagramAutoReplyText('  Hello.   How can I help you with   Modabella today?  '), true);
  assert.equal(isManagedInstagramAutoReplyText('Hi, do you have size M?'), false);
  assert.equal(isManagedInstagramAutoReplyText('Hello. I want to order from Cleopatra today'), false);
});

test('detects managed Instagram fallback auto-replies', () => {
  assert.equal(
    isManagedInstagramAutoReplyText(
      "Sorry, I didn't quite catch that. Could you share the item name, order ID, or the change you need? Or please call our team on 0701234567 or whatsapp 94701234567 during 9:00 am to 9:00 pm.",
    ),
    true,
  );
  assert.equal(
    isManagedInstagramAutoReplyText(
      'You can reach our support team directly. Please call our team on 0701234567 or WhatsApp 94701234567 during 9:00 AM to 9:00 PM.',
    ),
    true,
  );
  assert.equal(
    isManagedInstagramAutoReplyText(
      'I want to make sure you get the right help for this clarification request. Please call our team on 0701234567 or WhatsApp 94701234567 during 9:00 AM to 6:00 PM. I have also flagged this conversation for a team follow-up.',
    ),
    true,
  );
});

test('extracts sender IDs and message text from webhook events', () => {
  const messageEvent = {
    sender: { id: 'scoped-sender-1' },
    message: { text: 'Hello. How can I help you with Cleopatra today?' },
  };

  assert.equal(getWebhookSenderId(messageEvent), 'scoped-sender-1');
  assert.equal(
    getWebhookMessageTextForLoopGuard(messageEvent),
    'Hello. How can I help you with Cleopatra today?',
  );

  assert.equal(
    getWebhookMessageTextForLoopGuard({ postback: { payload: 'ORDER_NOW|productName=Dress' } }),
    'ORDER_NOW|productName=Dress',
  );
});

test('resolves global and brand-scoped internal Instagram sender IDs from env', () => {
  const env = {
    META_IG_INTERNAL_SENDER_IDS: 'global-1, global-2',
    META_IG_INTERNAL_SENDER_IDS_HAPPYBUY: 'happybuy-1',
    HAPPYBY_INSTAGRAM_INTERNAL_SENDER_IDS: 'legacy-happyby-1',
    CLEOPATRA_INSTAGRAM_INTERNAL_SENDER_IDS: 'cleopatra-1',
  };

  assert.deepEqual(
    [...getInstagramInternalSenderIdsForBrand('Happybuy', env)].sort(),
    ['global-1', 'global-2', 'happybuy-1', 'legacy-happyby-1'],
  );
  assert.deepEqual(
    [...getInstagramInternalSenderIdsForBrand('Cleopatra', env)].sort(),
    ['cleopatra-1', 'global-1', 'global-2'],
  );
});

test('resolves global and brand-scoped internal Messenger sender IDs from env', () => {
  const env = {
    META_MESSENGER_INTERNAL_SENDER_IDS: 'global-1;global-2',
    META_FB_INTERNAL_SENDER_IDS_HAPPYBUY: 'happybuy-1',
    HAPPYBY_MESSENGER_INTERNAL_SENDER_IDS: 'legacy-happyby-1',
    CLEOPATRA_FACEBOOK_INTERNAL_SENDER_IDS: 'cleopatra-1',
  };

  assert.deepEqual(
    [...getMessengerInternalSenderIdsForBrand('Happybuy', env)].sort(),
    ['global-1', 'global-2', 'happybuy-1', 'legacy-happyby-1'],
  );
  assert.deepEqual(
    [...getMessengerInternalSenderIdsForBrand('Cleopatra', env)].sort(),
    ['cleopatra-1', 'global-1', 'global-2'],
  );
});

test('chooses the first matching managed-account loop skip reason', () => {
  assert.equal(
    getInstagramBusinessLoopSkipReason({
      senderId: 'ig-account-1',
      messageText: 'normal customer text',
      configuredAccountIds: new Set(['ig-account-1']),
    }),
    'configured_business_account',
  );

  assert.equal(
    getInstagramBusinessLoopSkipReason({
      senderId: 'scoped-internal-1',
      messageText: 'normal customer text',
      configuredAccountIds: new Set(),
      internalSenderIds: new Set(['scoped-internal-1']),
    }),
    'configured_internal_sender',
  );

  assert.equal(
    getInstagramBusinessLoopSkipReason({
      senderId: 'unknown-sender',
      messageText: 'Hello. How can I help you with Happybuy today?',
      configuredAccountIds: new Set(),
    }),
    'managed_autoreply_greeting',
  );

  assert.equal(
    getInstagramBusinessLoopSkipReason({
      senderId: 'unknown-sender',
      messageText: 'You can reach our support team directly. Please call our team on 0701234567.',
      configuredAccountIds: new Set(),
    }),
    'managed_autoreply_fallback',
  );

  assert.equal(
    getInstagramBusinessLoopSkipReason({
      senderId: 'customer-1',
      messageText: 'Price please',
      configuredAccountIds: new Set(['ig-account-1']),
      internalSenderIds: new Set(['scoped-internal-1']),
    }),
    null,
  );
});

test('chooses Messenger managed-page loop skip reasons', () => {
  assert.equal(
    getMessengerBusinessLoopSkipReason({
      senderId: 'page-1',
      messageText: 'normal customer text',
      configuredPageIds: new Set(['page-1']),
    }),
    'configured_business_account',
  );

  assert.equal(
    getMessengerBusinessLoopSkipReason({
      senderId: 'scoped-page-sender',
      messageText: 'normal customer text',
      configuredPageIds: new Set(),
      internalSenderIds: new Set(['scoped-page-sender']),
    }),
    'configured_internal_sender',
  );

  assert.equal(
    getMessengerBusinessLoopSkipReason({
      senderId: 'unknown-sender',
      messageText: "Sorry, I didn't quite catch that. Could you share the item name?",
      configuredPageIds: new Set(),
    }),
    'managed_autoreply_fallback',
  );

  assert.equal(
    getMessengerBusinessLoopSkipReason({
      senderId: 'customer-1',
      messageText: 'Can I get the price?',
      configuredPageIds: new Set(['page-1']),
      internalSenderIds: new Set(['scoped-page-sender']),
    }),
    null,
  );
});
