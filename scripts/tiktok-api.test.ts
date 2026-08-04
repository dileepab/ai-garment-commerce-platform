import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTikTokAuthorizationUrl,
  exchangeTikTokAuthorizationCode,
  listTikTokAdvertisers,
  revokeTikTokAccessToken,
  TikTokApiError,
} from '../src/lib/tiktok-api.ts';

test('builds the TikTok advertiser authorization URL without app secrets', () => {
  const url = new URL(buildTikTokAuthorizationUrl({
    appId: 'app-123',
    redirectUri: 'https://app.deez.lk/api/integrations/tiktok/callback',
    state: 'signed.state',
    scope: '4,5',
  }));

  assert.equal(url.origin + url.pathname, 'https://ads.tiktok.com/marketing_api/auth');
  assert.equal(url.searchParams.get('app_id'), 'app-123');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.deez.lk/api/integrations/tiktok/callback');
  assert.equal(url.searchParams.get('state'), 'signed.state');
  assert.equal(url.searchParams.get('scope'), '4,5');
  assert.equal(url.toString().includes('secret'), false);
});

test('exchanges a single-use authorization code using TikTok v1.3 JSON fields', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await exchangeTikTokAuthorizationCode({
    appId: 'app-123',
    appSecret: 'app-secret',
    authorizationCode: 'single-use-code',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-1',
        data: {
          access_token: 'long-term-token',
          advertiser_ids: ['701', 702],
          scope: [4, '5'],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(requestUrl, 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/');
  assert.equal(new Headers(requestInit?.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    app_id: 'app-123',
    secret: 'app-secret',
    auth_code: 'single-use-code',
  });
  assert.deepEqual(result, {
    accessToken: 'long-term-token',
    advertiserIds: ['701', '702'],
    scopes: ['4', '5'],
    requestId: 'request-1',
  });
});

test('lists authorized advertisers with the access token only in the header', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await listTikTokAdvertisers({
    appId: 'app-123',
    appSecret: 'app-secret',
    accessToken: 'sensitive-access-token',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-2',
        data: {
          list: [
            { advertiser_id: '701', advertiser_name: 'HappyBuy' },
            { advertiser_id: 702, advertiser_name: '' },
          ],
        },
      }), { status: 200 });
    },
  });

  const url = new URL(requestUrl);
  assert.equal(url.pathname, '/open_api/v1.3/oauth2/advertiser/get/');
  assert.equal(url.searchParams.get('app_id'), 'app-123');
  assert.equal(url.searchParams.get('secret'), 'app-secret');
  assert.equal(requestUrl.includes('sensitive-access-token'), false);
  assert.equal(new Headers(requestInit?.headers).get('Access-Token'), 'sensitive-access-token');
  assert.deepEqual(result.advertisers, [
    { advertiserId: '701', advertiserName: 'HappyBuy' },
    { advertiserId: '702', advertiserName: null },
  ]);
});

test('revokes the long-term token using TikTok documented header and body', async () => {
  let requestInit: RequestInit | undefined;
  const result = await revokeTikTokAccessToken({
    appId: 'app-123',
    appSecret: 'app-secret',
    accessToken: 'long-term-token',
    fetchImpl: async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-3',
        data: { app_id: 'app-123', advertiser_ids: ['701'] },
      }), { status: 200 });
    },
  });

  assert.equal(requestInit?.method, 'POST');
  assert.equal(new Headers(requestInit?.headers).get('Access-Token'), 'long-term-token');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    app_id: 'app-123',
    secret: 'app-secret',
    access_token: 'long-term-token',
  });
  assert.deepEqual(result.advertiserIds, ['701']);
});

test('returns sanitized errors without echoing credentials or authorization codes', async () => {
  const secret = 'highly-sensitive-app-secret';
  const authorizationCode = 'sensitive-single-use-code';

  await assert.rejects(
    exchangeTikTokAuthorizationCode({
      appId: 'app-123',
      appSecret: secret,
      authorizationCode,
      fetchImpl: async () => new Response(JSON.stringify({
        code: 40001,
        message: `Secret ${secret} rejected code ${authorizationCode}`,
        request_id: 'request-4',
        data: {},
      }), { status: 400 }),
    }),
    (error: unknown) => {
      assert.equal(error instanceof TikTokApiError, true);
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes(secret), false);
      assert.equal(message.includes(authorizationCode), false);
      assert.match(message, /TikTok code 40001/);
      return true;
    },
  );
});
