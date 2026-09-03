import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addTikTokUrlPrefix,
  listTikTokUrlProperties,
  verifyTikTokUrlPrefix,
} from '../src/lib/tiktok-url-property.ts';

const credentials = {
  appId: '7670493447396114453',
  appSecret: 'test-app-secret',
};

test('lists, creates, and verifies the TikTok media URL prefix', async () => {
  const calls: Array<{ url: string; body: string | null }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
    const info = {
      url: 'https://app.deez.lk/api/content/creatives/',
      property_type: 2,
      property_status: url.includes('/verify/') ? 1 : 0,
      signature: 'verification-signature',
      file_name: 'verification-file.txt',
    };
    return new Response(JSON.stringify({
      code: 0,
      message: 'OK',
      request_id: 'request-id',
      data: url.includes('/list/')
        ? { url_property_info_list: [info] }
        : { url_property_info: info },
    }), { status: 200 });
  };

  const input = { ...credentials, fetchImpl: fetchImpl as typeof fetch };
  const listed = await listTikTokUrlProperties(input);
  const added = await addTikTokUrlPrefix(input, 'https://app.deez.lk/api/content/creatives/');
  const verified = await verifyTikTokUrlPrefix(input, 'https://app.deez.lk/api/content/creatives/');

  assert.equal(listed[0]?.fileName, 'verification-file.txt');
  assert.equal(added.status, 0);
  assert.equal(verified.status, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[1]?.body || '{}').url_property_meta, {
    property_type: 2,
    url: 'https://app.deez.lk/api/content/creatives/',
  });
});

test('keeps TikTok URL property errors bounded and excludes app credentials', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: 40002,
    message: `Invalid URL ${'x'.repeat(600)}`,
  }), { status: 200 });

  await assert.rejects(
    addTikTokUrlPrefix(
      { ...credentials, fetchImpl: fetchImpl as typeof fetch },
      'https://app.deez.lk/api/content/creatives/',
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /TikTok code 40002/);
      assert.equal(error.message.includes(credentials.appSecret), false);
      assert.ok(error.message.length < 400);
      return true;
    },
  );
});
