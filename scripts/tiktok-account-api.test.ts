import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configureTikTokAccountWebhook,
  exchangeTikTokAccountAuthorizationCode,
  getTikTokPostSettings,
  getTikTokPublishStatus,
  publishTikTokPhoto,
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

test('publishes TikTok photos with the account token only in the header', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await publishTikTokPhoto({
    accessToken: 'sensitive-token',
    businessId: '_000business',
    imageUrls: [
      'https://assets.deez.lk/creatives/look-1.jpg',
      'https://assets.deez.lk/creatives/look-2.webp',
    ],
    caption: 'Two ways to wear the new collection. #HappyBuy',
    privacyLevel: 'PUBLIC_TO_EVERYONE',
    disableComment: false,
    isBrandOrganic: true,
    isBrandedContent: false,
    autoAddMusic: true,
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-photo',
        data: { share_id: 'p_pub_url~v1.2345123456789123456' },
      }), { status: 200 });
    },
  });

  assert.equal(requestUrl, 'https://business-api.tiktok.com/open_api/v1.3/business/photo/publish/');
  assert.equal(requestUrl.includes('sensitive-token'), false);
  assert.equal(requestInit?.method, 'POST');
  assert.equal(new Headers(requestInit?.headers).get('Access-Token'), 'sensitive-token');
  assert.equal(new Headers(requestInit?.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    business_id: '_000business',
    photo_images: [
      'https://assets.deez.lk/creatives/look-1.jpg',
      'https://assets.deez.lk/creatives/look-2.webp',
    ],
    post_info: {
      privacy_level: 'PUBLIC_TO_EVERYONE',
      caption: 'Two ways to wear the new collection. #HappyBuy',
      disable_comment: false,
      is_brand_organic: true,
      is_branded_content: false,
      auto_add_music: true,
    },
  });
  assert.deepEqual(result, {
    shareId: 'p_pub_url~v1.2345123456789123456',
    requestId: 'request-photo',
  });
});

test('gets the TikTok account post settings before publishing', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await getTikTokPostSettings({
    accessToken: 'sensitive-token',
    businessId: '_000business',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-settings',
        data: {
          privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
          comment_disabled: false,
          duet_disabled: true,
          stitch_disabled: true,
          max_video_post_duration_sec: 600,
        },
      }), { status: 200 });
    },
  });

  const url = new URL(requestUrl);
  assert.equal(url.origin + url.pathname, 'https://business-api.tiktok.com/open_api/v1.3/business/video/settings/');
  assert.equal(url.searchParams.get('business_id'), '_000business');
  assert.equal(requestUrl.includes('sensitive-token'), false);
  assert.equal(requestInit?.method, 'GET');
  assert.equal(new Headers(requestInit?.headers).get('Access-Token'), 'sensitive-token');
  assert.deepEqual(result, {
    privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    commentDisabled: false,
    duetDisabled: true,
    stitchDisabled: true,
    maxVideoPostDurationSeconds: 600,
    requestId: 'request-settings',
  });
});

test('gets TikTok photo publishing status with IDs preserved as strings', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await getTikTokPublishStatus({
    accessToken: 'sensitive-token',
    businessId: '_000business',
    publishId: 'p_pub_url~v1.2345123456789123456',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-status',
        data: {
          status: 'PUBLISH_COMPLETE',
          post_ids: ['7461234567890123456'],
        },
      }), { status: 200 });
    },
  });

  const url = new URL(requestUrl);
  assert.equal(url.origin + url.pathname, 'https://business-api.tiktok.com/open_api/v1.3/business/publish/status/');
  assert.equal(url.searchParams.get('business_id'), '_000business');
  assert.equal(url.searchParams.get('publish_id'), 'p_pub_url~v1.2345123456789123456');
  assert.equal(requestUrl.includes('sensitive-token'), false);
  assert.equal(requestInit?.method, 'GET');
  assert.equal(requestInit?.body, undefined);
  assert.equal(new Headers(requestInit?.headers).get('Access-Token'), 'sensitive-token');
  assert.deepEqual(result, {
    status: 'PUBLISH_COMPLETE',
    postIds: ['7461234567890123456'],
    reason: null,
    requestId: 'request-status',
  });
});

test('parses a terminal TikTok photo publishing failure reason', async () => {
  const result = await getTikTokPublishStatus({
    accessToken: 'sensitive-token',
    businessId: '_000business',
    publishId: 'p_pub_url~v1.failed',
    fetchImpl: async () => new Response(JSON.stringify({
      code: 0,
      message: 'OK',
      request_id: 'request-failed-status',
      data: {
        status: 'FAILED',
        reason: 'photo_pull_failed',
      },
    }), { status: 200 }),
  });

  assert.deepEqual(result, {
    status: 'FAILED',
    postIds: [],
    reason: 'photo_pull_failed',
    requestId: 'request-failed-status',
  });
});

test('rejects missing IDs and unknown TikTok publishing statuses', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    getTikTokPublishStatus({
      accessToken: 'sensitive-token',
      businessId: '_000business',
      publishId: '   ',
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ code: 0, message: 'OK', data: {} }));
      },
    }),
    /publish.*ID|required/i,
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    getTikTokPublishStatus({
      accessToken: 'sensitive-token',
      businessId: '_000business',
      publishId: 'p_pub_url~v1.unknown',
      fetchImpl: async () => new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        request_id: 'request-unknown-status',
        data: { status: 'SOMETHING_NEW' },
      }), { status: 200 }),
    }),
    /status/i,
  );
});

test('rejects invalid TikTok photo inputs before calling the API', async () => {
  let fetchCalls = 0;
  const baseInput = {
    accessToken: 'sensitive-token',
    businessId: '_000business',
    caption: 'New collection',
    privacyLevel: 'PUBLIC_TO_EVERYONE' as const,
    disableComment: false,
    isBrandOrganic: true,
    isBrandedContent: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ code: 0, message: 'OK', data: {} }));
    },
  };

  await assert.rejects(
    publishTikTokPhoto({ ...baseInput, imageUrls: [] }),
    /at least one/i,
  );
  await assert.rejects(
    publishTikTokPhoto({
      ...baseInput,
      imageUrls: Array.from(
        { length: 36 },
        (_, index) => `https://assets.deez.lk/creatives/look-${index}.jpg`,
      ),
    }),
    /35/,
  );
  await assert.rejects(
    publishTikTokPhoto({
      ...baseInput,
      imageUrls: ['http://localhost:3000/api/content/creatives/1/image'],
    }),
    /https/i,
  );
  await assert.rejects(
    publishTikTokPhoto({
      ...baseInput,
      imageUrls: ['https://user:password@assets.deez.lk/creatives/look-1.jpg'],
    }),
    /credentials/i,
  );
  await assert.rejects(
    publishTikTokPhoto({
      ...baseInput,
      imageUrls: ['https://assets.deez.lk/creatives/look-1.jpg#private-fragment'],
    }),
    /fragment|hash/i,
  );
  await assert.rejects(
    publishTikTokPhoto({
      ...baseInput,
      imageUrls: ['https://assets.deez.lk/creatives/look-1.jpg'],
      caption: '   ',
    }),
    /caption/i,
  );
  await assert.rejects(
    publishTikTokPhoto({
      ...baseInput,
      imageUrls: ['https://assets.deez.lk/creatives/look-1.jpg'],
      caption: 'x'.repeat(4_001),
    }),
    /4,?000|caption/i,
  );
  await assert.rejects(
    publishTikTokPhoto({
      ...baseInput,
      imageUrls: ['https://assets.deez.lk/creatives/look-1.jpg'],
      caption: Array.from({ length: 31 }, (_, index) => `@person${index}`).join(' '),
    }),
    /30|mentions/i,
  );
  assert.equal(fetchCalls, 0);
});

test('returns sanitized TikTok photo publishing errors without echoing tokens', async () => {
  const secret = 'very-sensitive-account-token';
  await assert.rejects(
    publishTikTokPhoto({
      accessToken: secret,
      businessId: '_000business',
      imageUrls: ['https://assets.deez.lk/creatives/look-1.jpg'],
      caption: 'New collection',
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      disableComment: false,
      isBrandOrganic: true,
      isBrandedContent: false,
      fetchImpl: async () => new Response(JSON.stringify({
        code: 40001,
        message: `${secret} is missing Photo Publish permission`,
        request_id: 'request-photo-error',
      }), { status: 403 }),
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
