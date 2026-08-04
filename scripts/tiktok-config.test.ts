import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTikTokConfigStatus } from '../src/lib/tiktok-config.ts';

test('TikTok readiness requires a non-placeholder encryption key of sufficient length', () => {
  const original = {
    appId: process.env.TIKTOK_APP_ID,
    appSecret: process.env.TIKTOK_APP_SECRET,
    encryptionKey: process.env.TIKTOK_TOKEN_ENCRYPTION_KEY,
    redirectUri: process.env.TIKTOK_REDIRECT_URI,
  };

  try {
    process.env.TIKTOK_APP_ID = 'approved-app-id';
    process.env.TIKTOK_APP_SECRET = 'approved-app-secret';
    process.env.TIKTOK_REDIRECT_URI = 'https://app.deez.lk/api/integrations/tiktok/callback';

    process.env.TIKTOK_TOKEN_ENCRYPTION_KEY = 'short';
    assert.equal(getTikTokConfigStatus().tokenEncryptionConfigured, false);
    assert.equal(getTikTokConfigStatus().ready, false);

    process.env.TIKTOK_TOKEN_ENCRYPTION_KEY = 'generate_with_openssl_rand_base64_32';
    assert.equal(getTikTokConfigStatus().tokenEncryptionConfigured, false);

    process.env.TIKTOK_TOKEN_ENCRYPTION_KEY = 'a-real-stable-key-with-more-than-24-characters';
    assert.equal(getTikTokConfigStatus().tokenEncryptionConfigured, true);
    assert.equal(getTikTokConfigStatus().ready, true);
  } finally {
    if (original.appId === undefined) delete process.env.TIKTOK_APP_ID;
    else process.env.TIKTOK_APP_ID = original.appId;
    if (original.appSecret === undefined) delete process.env.TIKTOK_APP_SECRET;
    else process.env.TIKTOK_APP_SECRET = original.appSecret;
    if (original.encryptionKey === undefined) delete process.env.TIKTOK_TOKEN_ENCRYPTION_KEY;
    else process.env.TIKTOK_TOKEN_ENCRYPTION_KEY = original.encryptionKey;
    if (original.redirectUri === undefined) delete process.env.TIKTOK_REDIRECT_URI;
    else process.env.TIKTOK_REDIRECT_URI = original.redirectUri;
  }
});
