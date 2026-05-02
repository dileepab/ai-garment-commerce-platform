import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReturnCustomerNotification,
  canTransitionReturn,
  getActionsForReturnStatus,
  getReturnStatusLabel,
  getReturnTransitionError,
  getReturnTypeLabel,
  getValidNextStatuses,
  isReturnRequestStatus,
  isReturnRequestType,
  isTerminalReturnStatus,
  returnTransitionReconciliesStock,
  shouldNotifyCustomerForReturnTransition,
} from '../src/lib/returns.ts';

test('isReturnRequestStatus recognizes all valid statuses', () => {
  assert.equal(isReturnRequestStatus('requested'), true);
  assert.equal(isReturnRequestStatus('under_review'), true);
  assert.equal(isReturnRequestStatus('approved'), true);
  assert.equal(isReturnRequestStatus('rejected'), true);
  assert.equal(isReturnRequestStatus('item_received'), true);
  assert.equal(isReturnRequestStatus('replacement_processing'), true);
  assert.equal(isReturnRequestStatus('completed'), true);
  assert.equal(isReturnRequestStatus('garbage'), false);
  assert.equal(isReturnRequestStatus('returned'), false);
  assert.equal(isReturnRequestStatus(undefined), false);
});

test('isReturnRequestType recognizes return and exchange only', () => {
  assert.equal(isReturnRequestType('return'), true);
  assert.equal(isReturnRequestType('exchange'), true);
  assert.equal(isReturnRequestType('refund'), false);
  assert.equal(isReturnRequestType(''), false);
});

test('happy path return: requested → approved → item_received → completed', () => {
  const path: [string, string][] = [
    ['requested', 'approved'],
    ['approved', 'item_received'],
    ['item_received', 'completed'],
  ];
  for (const [from, to] of path) {
    assert.equal(
      canTransitionReturn(from as never, to as never),
      true,
      `expected ${from} -> ${to} to be allowed`,
    );
    assert.equal(getReturnTransitionError(from as never, to as never), null);
  }
});

test('happy path exchange: requested → approved → item_received → replacement_processing → completed', () => {
  const path: [string, string][] = [
    ['requested', 'approved'],
    ['approved', 'item_received'],
    ['item_received', 'replacement_processing'],
    ['replacement_processing', 'completed'],
  ];
  for (const [from, to] of path) {
    assert.equal(
      canTransitionReturn(from as never, to as never),
      true,
      `expected ${from} -> ${to} to be allowed`,
    );
  }
});

test('review step: requested → under_review → approved or rejected', () => {
  assert.equal(canTransitionReturn('requested', 'under_review'), true);
  assert.equal(canTransitionReturn('under_review', 'approved'), true);
  assert.equal(canTransitionReturn('under_review', 'rejected'), true);
  assert.equal(canTransitionReturn('requested', 'rejected'), true);
});

test('illegal transitions are rejected', () => {
  assert.equal(canTransitionReturn('requested', 'completed'), false);
  assert.equal(canTransitionReturn('rejected', 'approved'), false);
  assert.equal(canTransitionReturn('completed', 'requested'), false);
  assert.equal(canTransitionReturn('item_received', 'approved'), false);
  assert.equal(canTransitionReturn('approved', 'under_review'), false);
});

test('same-state transitions are rejected', () => {
  assert.equal(canTransitionReturn('requested', 'requested'), false);
  assert.equal(canTransitionReturn('approved', 'approved'), false);
  assert.match(
    getReturnTransitionError('approved', 'approved') || '',
    /already approved/,
  );
});

test('terminal statuses are correctly classified', () => {
  assert.equal(isTerminalReturnStatus('rejected'), true);
  assert.equal(isTerminalReturnStatus('completed'), true);
  assert.equal(isTerminalReturnStatus('approved'), false);
  assert.equal(isTerminalReturnStatus('requested'), false);
  assert.equal(isTerminalReturnStatus('item_received'), false);
});

test('stock reconciliation only triggers on item_received', () => {
  assert.equal(returnTransitionReconciliesStock('item_received'), true);
  assert.equal(returnTransitionReconciliesStock('approved'), false);
  assert.equal(returnTransitionReconciliesStock('completed'), false);
  assert.equal(returnTransitionReconciliesStock('replacement_processing'), false);
  assert.equal(returnTransitionReconciliesStock('rejected'), false);
});

test('customer notifications fire for approved, rejected, and completed only', () => {
  assert.equal(shouldNotifyCustomerForReturnTransition('approved'), true);
  assert.equal(shouldNotifyCustomerForReturnTransition('rejected'), true);
  assert.equal(shouldNotifyCustomerForReturnTransition('completed'), true);
  assert.equal(shouldNotifyCustomerForReturnTransition('requested'), false);
  assert.equal(shouldNotifyCustomerForReturnTransition('under_review'), false);
  assert.equal(shouldNotifyCustomerForReturnTransition('item_received'), false);
  assert.equal(shouldNotifyCustomerForReturnTransition('replacement_processing'), false);
});

test('getValidNextStatuses is type-aware for item_received', () => {
  const returnNext = getValidNextStatuses('item_received', 'return');
  assert.deepEqual(returnNext, ['completed']);

  const exchangeNext = getValidNextStatuses('item_received', 'exchange');
  assert.deepEqual(exchangeNext, ['replacement_processing']);
});

test('getValidNextStatuses for other statuses is type-independent', () => {
  const fromRequested = getValidNextStatuses('requested', 'return');
  assert.ok(fromRequested.includes('under_review'));
  assert.ok(fromRequested.includes('approved'));
  assert.ok(fromRequested.includes('rejected'));
});

test('customer notification messages include the order reference', () => {
  const approved = buildReturnCustomerNotification('approved', { orderId: 42, type: 'return' });
  assert.ok(approved);
  assert.match(approved, /#42/);
  assert.match(approved, /approved/);

  const rejected = buildReturnCustomerNotification('rejected', {
    orderId: 7,
    type: 'exchange',
    adminNote: 'outside the return window',
  });
  assert.ok(rejected);
  assert.match(rejected, /#7/);
  assert.match(rejected, /outside the return window/);
});

test('completed return and exchange notifications differ', () => {
  const returnDone = buildReturnCustomerNotification('completed', { orderId: 1, type: 'return' });
  assert.ok(returnDone);
  assert.match(returnDone, /return/i);
  assert.doesNotMatch(returnDone, /replacement/i);

  const exchangeDone = buildReturnCustomerNotification('completed', {
    orderId: 2,
    type: 'exchange',
    replacementOrderId: 99,
  });
  assert.ok(exchangeDone);
  assert.match(exchangeDone, /exchange/i);
  assert.match(exchangeDone, /order #99/);
});

test('non-notifiable transitions return null', () => {
  assert.equal(buildReturnCustomerNotification('under_review', { orderId: 1, type: 'return' }), null);
  assert.equal(buildReturnCustomerNotification('item_received', { orderId: 1, type: 'return' }), null);
  assert.equal(
    buildReturnCustomerNotification('replacement_processing', { orderId: 1, type: 'exchange' }),
    null,
  );
});

test('label helpers return human-readable strings', () => {
  assert.equal(getReturnStatusLabel('requested'), 'Requested');
  assert.equal(getReturnStatusLabel('item_received'), 'Item received');
  assert.equal(getReturnStatusLabel('replacement_processing'), 'Replacement processing');
  assert.equal(getReturnTypeLabel('return'), 'Return');
  assert.equal(getReturnTypeLabel('exchange'), 'Exchange');
});

test('action descriptors for each status are stage-appropriate', () => {
  const requestedActions = getActionsForReturnStatus('requested', 'return').map((a) => a.action);
  assert.ok(requestedActions.includes('review'));
  assert.ok(requestedActions.includes('approve'));
  assert.ok(requestedActions.includes('reject'));

  const approvedActions = getActionsForReturnStatus('approved', 'return').map((a) => a.action);
  assert.deepEqual(approvedActions, ['mark_item_received']);

  const itemReceivedReturn = getActionsForReturnStatus('item_received', 'return').map((a) => a.action);
  assert.deepEqual(itemReceivedReturn, ['complete']);

  const itemReceivedExchange = getActionsForReturnStatus('item_received', 'exchange').map((a) => a.action);
  assert.deepEqual(itemReceivedExchange, ['start_replacement']);

  const replacementActions = getActionsForReturnStatus('replacement_processing', 'exchange').map((a) => a.action);
  assert.deepEqual(replacementActions, ['complete']);

  assert.equal(getActionsForReturnStatus('completed', 'return').length, 0);
  assert.equal(getActionsForReturnStatus('rejected', 'return').length, 0);
});

test('reject action has requiresNote and is destructive', () => {
  const rejectAction = getActionsForReturnStatus('requested', 'return').find((a) => a.action === 'reject');
  assert.ok(rejectAction);
  assert.equal(rejectAction.requiresNote, true);
  assert.equal(rejectAction.destructive, true);
});
