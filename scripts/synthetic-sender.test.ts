import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSyntheticSenderId } from '../src/lib/synthetic-sender.ts';

test('simulator and test senders are recognised as synthetic', () => {
  assert.equal(isSyntheticSenderId('sim-1787035638518'), true);
  assert.equal(isSyntheticSenderId('zz-1785996452823'), true);
  assert.equal(isSyntheticSenderId('repeat-40132'), true);
  assert.equal(isSyntheticSenderId('test-1'), true);
  // Case and surrounding spaces come from hand-entered simulator runs.
  assert.equal(isSyntheticSenderId('  SIM-99  '), true);
});

test('a real page-scoped id is never treated as synthetic', () => {
  // Genuine Messenger PSIDs and WhatsApp numbers from the production inbox.
  assert.equal(isSyntheticSenderId('26518258224539263'), false);
  assert.equal(isSyntheticSenderId('94767567583'), false);
  assert.equal(isSyntheticSenderId('2014982019096822'), false);
  assert.equal(isSyntheticSenderId(''), false);
  assert.equal(isSyntheticSenderId(null), false);
  assert.equal(isSyntheticSenderId(undefined), false);
  // "simone" starts with the letters but is not a simulator id.
  assert.equal(isSyntheticSenderId('simone-42'), false);
});
