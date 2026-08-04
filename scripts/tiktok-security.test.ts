import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createTikTokOAuthState,
  decryptTikTokAccessToken,
  encryptTikTokAccessToken,
  verifyTikTokOAuthState,
} from '../src/lib/tiktok-security.ts';

const STATE_SECRET = 'state-secret-with-at-least-24-characters';
const TOKEN_SECRET = 'token-secret-with-at-least-24-characters';

test('creates and verifies brand-bound TikTok OAuth state', () => {
  const now = new Date('2026-08-04T10:00:00.000Z');
  const oauth = createTikTokOAuthState({
    brand: 'Happybuy',
    secret: STATE_SECRET,
    now,
    nonce: 'fixed-browser-nonce',
  });
  const payload = verifyTikTokOAuthState({
    state: oauth.state,
    expectedNonce: oauth.nonce,
    secret: STATE_SECRET,
    now: new Date('2026-08-04T10:05:00.000Z'),
  });

  assert.equal(payload.brand, 'Happybuy');
  assert.notEqual(payload.nonceHash, 'fixed-browser-nonce');
  assert.equal(oauth.state.includes('fixed-browser-nonce'), false);
  assert.equal(oauth.expiresAt.toISOString(), '2026-08-04T10:10:00.000Z');
});

test('rejects tampered, mismatched, and expired TikTok OAuth state', () => {
  const now = new Date('2026-08-04T10:00:00.000Z');
  const oauth = createTikTokOAuthState({
    brand: 'Happybuy',
    secret: STATE_SECRET,
    now,
    nonce: 'browser-nonce',
  });
  const [payload, signature] = oauth.state.split('.');
  const tamperedPayload = `${payload?.slice(0, -1)}A`;

  assert.throws(() => verifyTikTokOAuthState({
    state: `${tamperedPayload}.${signature}`,
    expectedNonce: oauth.nonce,
    secret: STATE_SECRET,
    now,
  }), /could not be verified/);
  assert.throws(() => verifyTikTokOAuthState({
    state: oauth.state,
    expectedNonce: 'different-browser',
    secret: STATE_SECRET,
    now,
  }), /does not match/);
  assert.throws(() => verifyTikTokOAuthState({
    state: oauth.state,
    expectedNonce: oauth.nonce,
    secret: STATE_SECRET,
    now: oauth.expiresAt,
  }), /expired/);
});

test('encrypts TikTok tokens with authenticated randomized encryption', () => {
  const accessToken = 'long-term-sensitive-tiktok-token';
  const first = encryptTikTokAccessToken(accessToken, TOKEN_SECRET);
  const second = encryptTikTokAccessToken(accessToken, TOKEN_SECRET);

  assert.notEqual(first, second);
  assert.equal(first.includes(accessToken), false);
  assert.equal(decryptTikTokAccessToken(first, TOKEN_SECRET), accessToken);
  assert.equal(decryptTikTokAccessToken(second, TOKEN_SECRET), accessToken);

  const parts = first.split('.');
  parts[3] = `${parts[3]?.slice(0, -1)}A`;
  assert.throws(
    () => decryptTikTokAccessToken(parts.join('.'), TOKEN_SECRET),
    /could not be decrypted/,
  );
});

test('rejects weak OAuth and encryption secrets', () => {
  assert.throws(() => createTikTokOAuthState({
    brand: 'Happybuy',
    secret: 'too-short',
  }), /at least 24/);
  assert.throws(
    () => encryptTikTokAccessToken('token', 'too-short'),
    /at least 24/,
  );
});
