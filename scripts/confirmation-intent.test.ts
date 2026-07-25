import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isClearConfirmation } from '../src/lib/confirmation-intent.ts';

test('recognizes natural, explicit order confirmations', () => {
  const confirmations = [
    'Yes, confirm and place the order',
    'Yes. Place it now.',
    'Yes, please confirm and place my order now',
    'Sure, go ahead and place it',
    'Please confirm and submit the order',
  ];

  for (const message of confirmations) {
    assert.equal(isClearConfirmation(message), true, message);
  }
});

test('does not treat acknowledgements, corrections, or cancellations as confirmation', () => {
  const nonConfirmations = [
    'okay',
    'not yet',
    "yes, but don't place the order",
    "yes, don't confirm the order",
    'yes, change the address first',
    'yes, change the size to L and confirm the order',
    'cancel the order',
    'wait — place it later',
    'what happens after I place the order?',
  ];

  for (const message of nonConfirmations) {
    assert.equal(isClearConfirmation(message), false, message);
  }
});
