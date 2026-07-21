import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWhatsAppRegistrationUrl,
  buildWhatsAppSubscriptionUrl,
  isValidWhatsAppRegistrationPin,
  registerWhatsAppPhone,
  subscribeWhatsAppBusinessAccount,
} from '../src/lib/whatsapp-registration.ts';

test('validates an exact six-digit WhatsApp registration PIN', () => {
  assert.equal(isValidWhatsAppRegistrationPin('638204'), true);
  assert.equal(isValidWhatsAppRegistrationPin('12345'), false);
  assert.equal(isValidWhatsAppRegistrationPin('1234567'), false);
  assert.equal(isValidWhatsAppRegistrationPin('12 456'), false);
  assert.equal(isValidWhatsAppRegistrationPin('12a456'), false);
});

test('builds the exact versioned Meta registration URL', () => {
  assert.equal(
    buildWhatsAppRegistrationUrl('1253912207801584', 'v22.0'),
    'https://graph.facebook.com/v22.0/1253912207801584/register',
  );
  assert.throws(
    () => buildWhatsAppRegistrationUrl('phone-id', 'v22.0'),
    /digits only/,
  );
});

test('builds the exact versioned WABA subscription URL', () => {
  assert.equal(
    buildWhatsAppSubscriptionUrl('996782980030310', 'v22.0'),
    'https://graph.facebook.com/v22.0/996782980030310/subscribed_apps',
  );
  assert.throws(
    () => buildWhatsAppSubscriptionUrl('waba-id', 'v22.0'),
    /digits only/,
  );
});

test('sends the token in the authorization header and the minimal registration body', async () => {
  const accessToken = 'test-system-user-token';
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  const result = await registerWhatsAppPhone({
    phoneNumberId: '1253912207801584',
    accessToken,
    pin: '638204',
    graphVersion: 'v22.0',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requestUrl, 'https://graph.facebook.com/v22.0/1253912207801584/register');
  assert.equal(requestUrl.includes(accessToken), false);
  assert.equal(new Headers(requestInit?.headers).get('Authorization'), `Bearer ${accessToken}`);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    messaging_product: 'whatsapp',
    pin: '638204',
  });
});

test('accepts Meta string success responses', async () => {
  const result = await registerWhatsAppPhone({
    phoneNumberId: '1253912207801584',
    accessToken: 'test-token',
    pin: '638204',
    graphVersion: 'v22.0',
    fetchImpl: async () => new Response(JSON.stringify({ success: 'true' }), { status: 200 }),
  });

  assert.equal(result.ok, true);
});

test('sanitizes Meta and transport failures', async () => {
  const accessToken = 'sensitive-token-value';
  const pin = '638204';
  const metaFailure = await registerWhatsAppPhone({
    phoneNumberId: '1253912207801584',
    accessToken,
    pin,
    graphVersion: 'v22.0',
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: 100,
        message: `Registration failed for ${pin} using ${accessToken}`,
      },
    }), { status: 400 }),
  });

  assert.equal(metaFailure.ok, false);
  assert.equal(metaFailure.errorCode, 100);
  assert.equal(metaFailure.error?.includes(pin), false);
  assert.equal(metaFailure.error?.includes(accessToken), false);

  const transportFailure = await registerWhatsAppPhone({
    phoneNumberId: '1253912207801584',
    accessToken,
    pin,
    graphVersion: 'v22.0',
    fetchImpl: async () => {
      throw new Error(`Bearer ${accessToken} rejected PIN ${pin}`);
    },
  });

  assert.equal(transportFailure.ok, false);
  assert.equal(transportFailure.error?.includes(pin), false);
  assert.equal(transportFailure.error?.includes(accessToken), false);
});

test('subscribes the WABA with the token only in the authorization header', async () => {
  const accessToken = 'test-system-user-token';
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  const result = await subscribeWhatsAppBusinessAccount({
    businessAccountId: '996782980030310',
    accessToken,
    graphVersion: 'v22.0',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requestUrl, 'https://graph.facebook.com/v22.0/996782980030310/subscribed_apps');
  assert.equal(requestUrl.includes(accessToken), false);
  assert.equal(new Headers(requestInit?.headers).get('Authorization'), `Bearer ${accessToken}`);
  assert.equal(requestInit?.body, undefined);
});

test('sanitizes WABA subscription failures', async () => {
  const accessToken = 'sensitive-subscription-token';
  const result = await subscribeWhatsAppBusinessAccount({
    businessAccountId: '996782980030310',
    accessToken,
    graphVersion: 'v22.0',
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: 10,
        message: `Token ${accessToken} cannot subscribe`,
      },
    }), { status: 403 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 10);
  assert.equal(result.error?.includes(accessToken), false);
});
