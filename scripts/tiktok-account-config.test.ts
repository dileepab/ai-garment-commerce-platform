import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTikTokAccountAuthorizationUrl,
  getTikTokAccountConfigStatus,
} from '../src/lib/tiktok-account-config.ts';

test('requires the exact approved account URL and a compliant trailing-slash callback', () => {
  const original = {
    appId: process.env.TIKTOK_APP_ID,
    appSecret: process.env.TIKTOK_APP_SECRET,
    encryptionKey: process.env.TIKTOK_TOKEN_ENCRYPTION_KEY,
    authUrl: process.env.TIKTOK_ACCOUNT_AUTHORIZATION_URL,
    redirect: process.env.TIKTOK_ACCOUNT_REDIRECT_URI,
  };
  try {
    process.env.TIKTOK_APP_ID = 'approved-app-id';
    process.env.TIKTOK_APP_SECRET = 'approved-app-secret';
    process.env.TIKTOK_TOKEN_ENCRYPTION_KEY = 'a-real-stable-key-with-more-than-24-characters';
    process.env.TIKTOK_ACCOUNT_AUTHORIZATION_URL = 'https://www.tiktok.com/v2/auth/authorize/?client_key=approved-app-id&scope=comment.list&redirect_uri=https%3A%2F%2Fapp.deez.lk%2Fapi%2Fintegrations%2Ftiktok%2Faccount%2Fcallback%2F';
    process.env.TIKTOK_ACCOUNT_REDIRECT_URI = 'https://app.deez.lk/api/integrations/tiktok/account/callback';
    assert.equal(getTikTokAccountConfigStatus().readyForAuthorization, false);

    process.env.TIKTOK_ACCOUNT_REDIRECT_URI = 'https://app.deez.lk/a-different-callback/';
    assert.equal(getTikTokAccountConfigStatus().readyForAuthorization, false);

    process.env.TIKTOK_ACCOUNT_REDIRECT_URI = 'https://app.deez.lk/api/integrations/tiktok/account/callback/';
    assert.equal(getTikTokAccountConfigStatus().readyForAuthorization, true);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      const envKey = {
        appId: 'TIKTOK_APP_ID',
        appSecret: 'TIKTOK_APP_SECRET',
        encryptionKey: 'TIKTOK_TOKEN_ENCRYPTION_KEY',
        authUrl: 'TIKTOK_ACCOUNT_AUTHORIZATION_URL',
        redirect: 'TIKTOK_ACCOUNT_REDIRECT_URI',
      }[key] as string;
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});

test('adds state without exposing an app secret in the authorization URL', () => {
  const url = new URL(buildTikTokAccountAuthorizationUrl(
    'https://www.tiktok.com/v2/auth/authorize/?client_key=app-123&scope=comment.list,message.list.send',
    'signed.state',
  ));
  assert.equal(url.searchParams.get('state'), 'signed.state');
  assert.equal(url.searchParams.get('disable_auto_auth'), '1');
  assert.equal(url.searchParams.has('client_secret'), false);
});
