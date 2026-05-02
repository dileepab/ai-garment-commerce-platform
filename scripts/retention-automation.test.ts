import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCartRecoveryMessage,
  buildPostOrderFollowUpMessage,
  buildReorderReminderMessage,
  buildSupportTimeoutMessage,
  CART_RECOVERY_DELAY_MS,
  CART_RECOVERY_COOLDOWN_MS,
  getSupportAutomationBlockReason,
  PURCHASE_NUDGE_COOLDOWN_MS,
  shouldSendCartRecoveryReminder,
  shouldSendPurchaseRetentionMessage,
  shouldSendSupportTimeoutFollowUp,
  SUPPORT_TIMEOUT_DELAY_MS,
} from '../src/lib/retention-policy.ts';

const now = new Date('2026-05-02T09:00:00.000Z');

function ago(ms: number): Date {
  return new Date(now.getTime() - ms);
}

test('cart recovery sends only for stale supported-channel order drafts', () => {
  assert.deepEqual(
    shouldSendCartRecoveryReminder({
      channel: 'instagram',
      hasOrderDraft: true,
      pendingStep: 'order_confirmation',
      stateUpdatedAt: ago(CART_RECOVERY_DELAY_MS + 1),
      now,
    }),
    { send: true }
  );

  assert.equal(
    shouldSendCartRecoveryReminder({
      channel: 'sms',
      hasOrderDraft: true,
      pendingStep: 'order_confirmation',
      stateUpdatedAt: ago(CART_RECOVERY_DELAY_MS + 1),
      now,
    }).reason,
    'unsupported_channel'
  );

  assert.equal(
    shouldSendCartRecoveryReminder({
      channel: 'messenger',
      hasOrderDraft: true,
      pendingStep: 'order_confirmation',
      stateUpdatedAt: ago(CART_RECOVERY_DELAY_MS - 1),
      now,
    }).reason,
    'not_stale_enough'
  );
});

test('support locks block normal retention automation', () => {
  assert.equal(
    getSupportAutomationBlockReason({
      supportMode: 'handoff_requested',
      escalationStatus: 'open',
    }),
    'support_handoff_requested'
  );

  assert.equal(
    getSupportAutomationBlockReason({
      supportMode: 'human_active',
      escalationStatus: 'in_progress',
    }),
    'human_support_active'
  );

  assert.equal(
    shouldSendCartRecoveryReminder({
      channel: 'messenger',
      hasOrderDraft: true,
      pendingStep: 'contact_collection',
      stateUpdatedAt: ago(CART_RECOVERY_DELAY_MS + 1),
      now,
      supportBlockReason: 'support_handoff_requested',
    }).reason,
    'support_handoff_requested'
  );
});

test('support timeout is the explicit stale-handoff exception, not a human-active bypass', () => {
  assert.equal(
    getSupportAutomationBlockReason({
      supportMode: 'handoff_requested',
      escalationStatus: 'open',
      allowStaleHandoffResume: true,
    }),
    null
  );

  assert.deepEqual(
    shouldSendSupportTimeoutFollowUp({
      channel: 'messenger',
      escalationStatus: 'open',
      escalationUpdatedAt: ago(SUPPORT_TIMEOUT_DELAY_MS + 1),
      now,
      supportBlockReason: null,
    }),
    { send: true }
  );

  assert.equal(
    shouldSendSupportTimeoutFollowUp({
      channel: 'messenger',
      escalationStatus: 'open',
      escalationUpdatedAt: ago(SUPPORT_TIMEOUT_DELAY_MS + 1),
      now,
      supportBlockReason: 'human_support_active',
    }).reason,
    'human_support_active'
  );
});

test('cooldowns prevent overly frequent retention nudges', () => {
  assert.equal(
    shouldSendCartRecoveryReminder({
      channel: 'messenger',
      hasOrderDraft: true,
      pendingStep: 'order_confirmation',
      stateUpdatedAt: ago(CART_RECOVERY_DELAY_MS + 1),
      now,
      recentSentAt: ago(CART_RECOVERY_COOLDOWN_MS - 1),
    }).reason,
    'cart_recovery_cooldown'
  );

  assert.equal(
    shouldSendPurchaseRetentionMessage({
      channel: 'instagram',
      hasCustomerTarget: true,
      now,
      recentSentAt: ago(PURCHASE_NUDGE_COOLDOWN_MS - 1),
    }).reason,
    'purchase_nudge_cooldown'
  );
});

test('retention messages stay concise and professional', () => {
  const messages = [
    buildCartRecoveryMessage({
      customerName: 'Test Customer',
      productName: 'Relaxed Linen Pants',
    }),
    buildSupportTimeoutMessage(),
    buildPostOrderFollowUpMessage({
      customerName: 'Test Customer',
      orderId: 42,
    }),
    buildReorderReminderMessage({
      customerName: 'Test Customer',
      productName: 'Oversized Casual Top',
    }),
  ];

  for (const message of messages) {
    assert(message.length <= 160, `Expected short message, received: ${message}`);
    assert(!/sorry to say|occupied|spam/i.test(message), `Message has poor wording: ${message}`);
  }
});
