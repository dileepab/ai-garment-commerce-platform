import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyTikTokWebhookSignature } from '../src/lib/tiktok-webhook-signature.ts';

const APP_SECRET = 'approved-tiktok-app-secret';
const TIMESTAMP = 1_786_000_000;
const RAW_BODY = '{"client_key":"app-123","event":"comment.update","content":"{}"}';

function signatureFor(rawBody = RAW_BODY, timestamp = TIMESTAMP): string {
  const signature = createHmac('sha256', APP_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `t=${timestamp},s=${signature}`;
}

test('accepts a current TikTok signature over the exact raw body', () => {
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: signatureFor(),
    appSecret: APP_SECRET,
    now: new Date(TIMESTAMP * 1000),
  }), true);
});

test('rejects changed bytes, wrong credentials, and malformed headers', () => {
  const now = new Date(TIMESTAMP * 1000);
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: `${RAW_BODY}\n`,
    signatureHeader: signatureFor(),
    appSecret: APP_SECRET,
    now,
  }), false);
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: signatureFor(),
    appSecret: 'wrong-secret',
    now,
  }), false);
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: 't=1786000000,s=not-hex',
    appSecret: APP_SECRET,
    now,
  }), false);
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: null,
    appSecret: APP_SECRET,
    now,
  }), false);
});

test('rejects stale and implausibly future webhook timestamps', () => {
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: signatureFor(),
    appSecret: APP_SECRET,
    now: new Date((TIMESTAMP + 301) * 1000),
  }), false);
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: signatureFor(),
    appSecret: APP_SECRET,
    now: new Date((TIMESTAMP - 301) * 1000),
  }), false);
});

test('supports multiple signed secrets while requiring one timestamp', () => {
  const valid = signatureFor().split('s=')[1];
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: `t=${TIMESTAMP},s=${'0'.repeat(64)},s=${valid}`,
    appSecret: APP_SECRET,
    now: new Date(TIMESTAMP * 1000),
  }), true);
  assert.equal(verifyTikTokWebhookSignature({
    rawBody: RAW_BODY,
    signatureHeader: `${signatureFor()},t=${TIMESTAMP}`,
    appSecret: APP_SECRET,
    now: new Date(TIMESTAMP * 1000),
  }), false);
});
