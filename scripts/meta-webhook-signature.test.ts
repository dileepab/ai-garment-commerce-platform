import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyMetaWebhookSignature } from '../src/lib/meta-webhook-signature.ts';

test('accepts an exact Meta SHA-256 webhook signature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const secret = 'test-app-secret';
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  assert.equal(verifyMetaWebhookSignature(body, signature, secret), true);
});

test('rejects altered payloads, malformed signatures, and missing secrets', () => {
  const body = '{"object":"whatsapp_business_account"}';
  const secret = 'test-app-secret';
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  assert.equal(verifyMetaWebhookSignature(`${body} `, signature, secret), false);
  assert.equal(verifyMetaWebhookSignature(body, 'sha256=bad', secret), false);
  assert.equal(verifyMetaWebhookSignature(body, signature, undefined), false);
  assert.equal(verifyMetaWebhookSignature(body, null, secret), false);
});
