import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configureTikTokAccountWebhook,
  exchangeTikTokAccountAuthorizationCode,
  refreshTikTokAccountAccessToken,
  sendTikTokCommentReply,
  sendTikTokDirectMessage,
  TikTokAccountApiError,
} from '../src/lib/tiktok-account-api.ts';

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    code: 0,
    message: 'OK',
    request_id: 'request-1',
    data: {
      access_token: 'short-token',
      refresh_token: 'refresh-token',
      open_id: '_000business',
      scope: 'comment.list,comment.list.manage,message.list.read,message.list.send',
      expires_in: 86_400,
      refresh_token_expires_in: 31_536_000,
      ...overrides,
    },
  }), { status: 200 });
}

test('exchanges an account-holder code using the short-term token contract', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await exchangeTikTokAccountAuthorizationCode({
    clientId: 'app-123',
    clientSecret: 'app-secret',
    authorizationCode: 'one-time-code',
    redirectUri: 'https://app.deez.lk/api/integrations/tiktok/account/callback/',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return tokenResponse();
    },
  });

  assert.equal(requestUrl, 'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    client_id: 'app-123',
    client_secret: 'app-secret',
    grant_type: 'authorization_code',
    auth_code: 'one-time-code',
    redirect_uri: 'https://app.deez.lk/api/integrations/tiktok/account/callback/',
  });
  assert.deepEqual(result.scopes, [
    'comment.list',
    'comment.list.manage',
    'message.list.read',
    'message.list.send',
  ]);
  assert.equal(result.openId, '_000business');
});

test('refreshes account tokens and expects rotated access and refresh tokens', async () => {
  let requestInit: RequestInit | undefined;
  const result = await refreshTikTokAccountAccessToken({
    clientId: 'app-123',
    clientSecret: 'app-secret',
    refreshToken: 'old-refresh-token',
    fetchImpl: async (_input, init) => {
      requestInit = init;
      return tokenResponse({ access_token: 'new-access', refresh_token: 'new-refresh' });
    },
  });

  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    client_id: 'app-123',
    client_secret: 'app-secret',
    grant_type: 'refresh_token',
    refresh_token: 'old-refresh-token',
  });
  assert.equal(result.accessToken, 'new-access');
  assert.equal(result.refreshToken, 'new-refresh');
});

test('replies to the exact TikTok video comment with the token only in a header', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await sendTikTokCommentReply({
    accessToken: 'sensitive-token',
    businessId: '_000business',
    videoId: '7203000000000000002',
    commentId: '7247000000000000001',
    text: 'Medium is available.',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-2',
        data: { comment_id: '7250000000000000003' },
      }), { status: 200 });
    },
  });

  assert.equal(requestUrl, 'https://business-api.tiktok.com/open_api/v1.3/business/comment/reply/create/');
  assert.equal(requestUrl.includes('sensitive-token'), false);
  assert.equal(new Headers(requestInit?.headers).get('Access-Token'), 'sensitive-token');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    business_id: '_000business',
    video_id: '7203000000000000002',
    comment_id: '7247000000000000001',
    text: 'Medium is available.',
  });
  assert.equal(result.ok, true);
});

test('sends a text DM to the exact TikTok conversation', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await sendTikTokDirectMessage({
    accessToken: 'sensitive-token',
    businessId: '_000business',
    conversationId: '7388+000000000000001',
    text: 'Yes, you can order it here.',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-dm',
        data: { message_id: '7390000000000000003' },
      }), { status: 200 });
    },
  });

  assert.equal(requestUrl, 'https://business-api.tiktok.com/open_api/v1.3/business/message/send/');
  assert.equal(new Headers(requestInit?.headers).get('Access-Token'), 'sensitive-token');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    business_id: '_000business',
    recipient_type: 'CONVERSATION',
    recipient: '7388+000000000000001',
    message_type: 'TEXT',
    text: { body: 'Yes, you can order it here.' },
  });
  assert.equal(result.ok, true);
});

test('configures app-level TikTok comment and DM webhooks without an account token', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({
      code: 0,
      message: 'OK',
      request_id: `request-${requests.length}`,
      data: {},
    }), { status: 200 });
  };
  for (const eventType of ['COMMENT', 'DIRECT_MESSAGE'] as const) {
    await configureTikTokAccountWebhook({
      clientId: 'app-123',
      clientSecret: 'app-secret',
      eventType,
      callbackUrl: 'https://app.deez.lk/api/webhooks/tiktok',
      fetchImpl,
    });
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, 'https://business-api.tiktok.com/open_api/v1.3/business/webhook/update/');
  assert.equal(new Headers(requests[0]?.init?.headers).has('Access-Token'), false);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    app_id: 'app-123',
    secret: 'app-secret',
    event_type: 'COMMENT',
    callback_url: 'https://app.deez.lk/api/webhooks/tiktok',
  });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    app_id: 'app-123',
    secret: 'app-secret',
    event_type: 'DIRECT_MESSAGE',
    callback_url: 'https://app.deez.lk/api/webhooks/tiktok',
  });
});

test('returns sanitized TikTok errors without echoing secrets', async () => {
  const secret = 'very-sensitive-client-secret';
  await assert.rejects(
    exchangeTikTokAccountAuthorizationCode({
      clientId: 'app-123',
      clientSecret: secret,
      authorizationCode: 'sensitive-code',
      redirectUri: 'https://app.deez.lk/api/integrations/tiktok/account/callback/',
      fetchImpl: async () => new Response(JSON.stringify({
        code: 40001,
        message: `${secret} is invalid`,
        request_id: 'request-3',
      }), { status: 400 }),
    }),
    (error: unknown) => {
      assert.equal(error instanceof TikTokAccountApiError, true);
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes(secret), false);
      assert.match(message, /TikTok code 40001/);
      return true;
    },
  );
});
