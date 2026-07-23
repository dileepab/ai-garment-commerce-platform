import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSupportConversationKey,
  parseSupportConversationKey,
  shouldAttachResolvedSupportCase,
  SupportInboxError,
} from '../src/lib/support-inbox-core.ts';

test('support conversation keys round-trip the exact brand/channel/sender tuple', () => {
  const identity = {
    brand: 'Happybuy',
    channel: 'whatsapp',
    senderId: '94710000000',
  };
  const key = createSupportConversationKey(identity);

  assert.deepEqual(parseSupportConversationKey(key), identity);
  assert.notEqual(
    key,
    createSupportConversationKey({ ...identity, brand: 'DEEZ' })
  );
  assert.deepEqual(
    parseSupportConversationKey(
      createSupportConversationKey({ ...identity, brand: null })
    ),
    { ...identity, brand: null }
  );
});

test('support conversation keys reject a tampered checksum', () => {
  const key = createSupportConversationKey({
    brand: 'Happybuy',
    channel: 'messenger',
    senderId: 'customer-123',
  });
  const replacement = key.endsWith('A') ? 'B' : 'A';
  const tamperedKey = `${key.slice(0, -1)}${replacement}`;

  assert.throws(
    () => parseSupportConversationKey(tamperedKey),
    SupportInboxError
  );
});

test('a resolved case remains attached only until newer chat activity exists', () => {
  const resolvedCase = {
    status: 'resolved',
    updatedAt: new Date('2026-07-22T10:00:00.000Z'),
    resolvedAt: new Date('2026-07-22T10:00:00.000Z'),
  };

  assert.equal(shouldAttachResolvedSupportCase(resolvedCase, null), true);
  assert.equal(
    shouldAttachResolvedSupportCase(
      resolvedCase,
      new Date('2026-07-22T10:00:00.000Z')
    ),
    true
  );
  assert.equal(
    shouldAttachResolvedSupportCase(
      resolvedCase,
      new Date('2026-07-22T10:00:00.001Z')
    ),
    false
  );
  assert.equal(
    shouldAttachResolvedSupportCase(
      { ...resolvedCase, status: 'in_progress' },
      new Date('2026-07-22T09:00:00.000Z')
    ),
    false
  );
});
