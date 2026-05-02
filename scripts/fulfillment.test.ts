import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCustomerNotificationMessage,
  canTransitionFulfillment,
  getActionByName,
  getActionsForStatus,
  getFulfillmentLabel,
  getFulfillmentNote,
  getFulfillmentTransitionError,
  getPrimaryActionForStatus,
  isTerminalFulfillmentStatus,
  normalizeFulfillmentStatus,
  shouldNotifyCustomerForTransition,
  transitionRestoresStock,
} from '../src/lib/fulfillment.ts';

test('normalizeFulfillmentStatus aliases shipped to dispatched and falls back to pending', () => {
  assert.equal(normalizeFulfillmentStatus('shipped'), 'dispatched');
  assert.equal(normalizeFulfillmentStatus('Dispatched'), 'dispatched');
  assert.equal(normalizeFulfillmentStatus('packed'), 'packed');
  assert.equal(normalizeFulfillmentStatus(undefined), 'pending');
  assert.equal(normalizeFulfillmentStatus('garbage'), 'pending');
});

test('happy path transitions are allowed', () => {
  const path: [string, string][] = [
    ['pending', 'confirmed'],
    ['confirmed', 'packing'],
    ['packing', 'packed'],
    ['packed', 'dispatched'],
    ['dispatched', 'delivered'],
  ];
  for (const [from, to] of path) {
    assert.equal(
      canTransitionFulfillment(from, to),
      true,
      `expected ${from} -> ${to} to be allowed`,
    );
    assert.equal(getFulfillmentTransitionError(from, to), null, `${from} -> ${to}`);
  }
});

test('shipped acts as dispatched alias for transitions in both directions', () => {
  // dispatched can be reached via packed
  assert.equal(canTransitionFulfillment('packed', 'shipped'), true);
  // and shipped can be moved to delivered or delivery_failed
  assert.equal(canTransitionFulfillment('shipped', 'delivered'), true);
  assert.equal(canTransitionFulfillment('shipped', 'delivery_failed'), true);
});

test('illegal transitions are rejected with descriptive errors', () => {
  assert.equal(canTransitionFulfillment('pending', 'dispatched'), false);
  assert.match(
    getFulfillmentTransitionError('pending', 'dispatched') || '',
    /Cannot move from pending to dispatched/,
  );

  assert.equal(canTransitionFulfillment('delivered', 'pending'), false);
  assert.equal(canTransitionFulfillment('cancelled', 'confirmed'), false);
  assert.equal(canTransitionFulfillment('returned', 'delivered'), false);
});

test('same-state transitions are rejected', () => {
  assert.equal(canTransitionFulfillment('packing', 'packing'), false);
  assert.match(
    getFulfillmentTransitionError('packed', 'packed') || '',
    /already packed/,
  );
});

test('delivery failure can recover into dispatched, returned, or cancelled', () => {
  assert.equal(canTransitionFulfillment('delivery_failed', 'dispatched'), true);
  assert.equal(canTransitionFulfillment('delivery_failed', 'returned'), true);
  assert.equal(canTransitionFulfillment('delivery_failed', 'cancelled'), true);
  assert.equal(canTransitionFulfillment('delivery_failed', 'delivered'), false);
});

test('returns can come from delivered or delivery_failed but never from cancelled', () => {
  assert.equal(canTransitionFulfillment('delivered', 'returned'), true);
  assert.equal(canTransitionFulfillment('delivery_failed', 'returned'), true);
  assert.equal(canTransitionFulfillment('cancelled', 'returned'), false);
});

test('terminal statuses are correctly classified', () => {
  assert.equal(isTerminalFulfillmentStatus('delivered'), true);
  assert.equal(isTerminalFulfillmentStatus('returned'), true);
  assert.equal(isTerminalFulfillmentStatus('cancelled'), true);
  assert.equal(isTerminalFulfillmentStatus('packed'), false);
  assert.equal(isTerminalFulfillmentStatus('dispatched'), false);
});

test('only the right transitions notify the customer', () => {
  // Allowed transitions that should notify
  assert.equal(shouldNotifyCustomerForTransition('pending', 'confirmed'), true);
  assert.equal(shouldNotifyCustomerForTransition('packed', 'dispatched'), true);
  assert.equal(shouldNotifyCustomerForTransition('dispatched', 'delivered'), true);
  assert.equal(shouldNotifyCustomerForTransition('dispatched', 'delivery_failed'), true);
  assert.equal(shouldNotifyCustomerForTransition('delivered', 'returned'), true);

  // Internal stage moves stay quiet — customers don't need a Messenger ping
  // every time the warehouse status nudges along
  assert.equal(shouldNotifyCustomerForTransition('confirmed', 'packing'), false);
  assert.equal(shouldNotifyCustomerForTransition('packing', 'packed'), false);

  // Cancellation has its own dedicated message in order-cancellation.ts —
  // never let the fulfillment notifier double-post
  assert.equal(shouldNotifyCustomerForTransition('confirmed', 'cancelled'), false);

  // Illegal transitions never notify
  assert.equal(shouldNotifyCustomerForTransition('pending', 'delivered'), false);
});

test('only returns release stock back to inventory', () => {
  assert.equal(transitionRestoresStock('delivered', 'returned'), true);
  assert.equal(transitionRestoresStock('delivery_failed', 'returned'), true);
  assert.equal(transitionRestoresStock('confirmed', 'cancelled'), false);
  assert.equal(transitionRestoresStock('packed', 'dispatched'), false);
});

test('customer-facing messages include tracking when present', () => {
  const message = buildCustomerNotificationMessage('dispatched', {
    orderId: 42,
    trackingNumber: 'TRK-123',
    courier: 'Domex',
  });
  assert.ok(message);
  assert.match(message, /#42/);
  assert.match(message, /Domex/);
  assert.match(message, /TRK-123/);
});

test('dispatched message gracefully omits missing tracking metadata', () => {
  const message = buildCustomerNotificationMessage('dispatched', { orderId: 7 });
  assert.equal(
    message,
    'Great news! Your order #7 has been dispatched and is on its way.',
  );
});

test('delivery failed and returned messages surface the reason', () => {
  const failed = buildCustomerNotificationMessage('delivery_failed', {
    orderId: 9,
    failureReason: 'recipient unavailable',
  });
  assert.match(failed || '', /recipient unavailable/);

  const returned = buildCustomerNotificationMessage('returned', {
    orderId: 10,
    returnReason: 'wrong size',
  });
  assert.match(returned || '', /wrong size/);
});

test('unsupported transitions return no customer message', () => {
  assert.equal(
    buildCustomerNotificationMessage('packing', { orderId: 1 }),
    null,
  );
  assert.equal(
    buildCustomerNotificationMessage('cancelled', { orderId: 1 }),
    null,
  );
});

test('action descriptors expose stage-appropriate next steps', () => {
  const pendingActions = getActionsForStatus('pending').map((a) => a.action);
  assert.deepEqual(pendingActions, ['confirm', 'cancel']);

  const dispatchedActions = getActionsForStatus('dispatched').map((a) => a.action);
  assert.deepEqual(dispatchedActions, ['mark_delivered', 'mark_delivery_failed']);

  const deliveredActions = getActionsForStatus('delivered').map((a) => a.action);
  assert.deepEqual(deliveredActions, ['mark_returned']);

  const failedActions = getActionsForStatus('delivery_failed').map((a) => a.action);
  assert.deepEqual(failedActions, ['retry_dispatch', 'mark_returned', 'cancel']);

  const returnedActions = getActionsForStatus('returned');
  assert.equal(returnedActions.length, 0);
});

test('dispatch action requires tracking input, failure/return require a reason', () => {
  assert.equal(getActionByName('packed', 'dispatch')?.requiresTracking, true);
  assert.equal(getActionByName('dispatched', 'mark_delivery_failed')?.requiresReason, true);
  assert.equal(getActionByName('delivered', 'mark_returned')?.requiresReason, true);
});

test('primary action skips destructive options', () => {
  assert.equal(getPrimaryActionForStatus('pending')?.action, 'confirm');
  assert.equal(getPrimaryActionForStatus('packed')?.action, 'dispatch');
  assert.equal(getPrimaryActionForStatus('returned'), null);
});

test('labels and notes round-trip through normalization', () => {
  assert.equal(getFulfillmentLabel('shipped'), 'Dispatched');
  assert.equal(getFulfillmentLabel('delivery_failed'), 'Delivery failed');
  assert.match(getFulfillmentNote('delivery_failed'), /delivery issue/);
  assert.match(getFulfillmentNote('returned'), /returned/);
});
