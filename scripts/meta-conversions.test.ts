import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildMessagingConversionPayload,
  isWithinAttributionWindow,
  isPlaceholderClickIdRejection,
  CTWA_ATTRIBUTION_WINDOW_DAYS,
} from '../src/lib/meta-conversions-payload.ts';

const BASE = {
  eventName: 'Purchase' as const,
  clickId: 'ARAaBBccDDee_clickid',
  whatsappBusinessAccountId: '1253000000001584',
  currency: 'LKR',
  value: 1690,
  eventId: 'order-42',
  eventTime: new Date('2026-08-19T18:30:00.000Z'),
};

test('the purchase event carries everything Meta needs to credit the ad', () => {
  const [event] = buildMessagingConversionPayload(BASE).data;

  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.action_source, 'business_messaging');
  assert.equal(event.messaging_channel, 'whatsapp');
  // Without the click id the event is accepted and then tied to no ad, which
  // is the same as not sending it.
  assert.equal(event.user_data.ctwa_clid, 'ARAaBBccDDee_clickid');
  assert.equal(event.user_data.whatsapp_business_account_id, '1253000000001584');
  assert.deepEqual(event.custom_data, { currency: 'LKR', value: 1690 });
});

test('event_time is in seconds, not milliseconds', () => {
  const [event] = buildMessagingConversionPayload(BASE).data;
  assert.equal(event.event_time, 1787164200);
  // A millisecond timestamp reads as a date tens of thousands of years out.
  assert.ok(event.event_time < 2_000_000_000);
});

test('the order id is the dedupe key, so a retry is not a second sale', () => {
  const first = buildMessagingConversionPayload(BASE).data[0];
  const retry = buildMessagingConversionPayload({
    ...BASE,
    eventTime: new Date('2026-08-19T18:45:00.000Z'),
  }).data[0];

  assert.equal(first.event_id, 'order-42');
  assert.equal(retry.event_id, first.event_id);
  assert.notEqual(retry.event_time, first.event_time);
});

test('only clicks inside the seven-day window are worth sending', () => {
  const now = new Date('2026-08-19T18:30:00.000Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  assert.equal(CTWA_ATTRIBUTION_WINDOW_DAYS, 7);
  assert.equal(isWithinAttributionWindow(daysAgo(0), now), true);
  assert.equal(isWithinAttributionWindow(daysAgo(6.9), now), true);
  // Our own referral record keeps thirty days for reporting; Meta credits seven.
  assert.equal(isWithinAttributionWindow(daysAgo(7.1), now), false);
  assert.equal(isWithinAttributionWindow(daysAgo(30), now), false);
});

test('a click timestamp in the future is not treated as fresh', () => {
  const now = new Date('2026-08-19T18:30:00.000Z');
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(isWithinAttributionWindow(tomorrow, now), false);
  assert.equal(isWithinAttributionWindow(new Date('nonsense'), now), false);
});

test('a real sale carries no test event code, so it is actually credited', () => {
  const payload = buildMessagingConversionPayload(BASE);
  // Present-but-empty would route every sale to Test Events, where Meta
  // credits nothing. The key has to be absent.
  assert.equal('test_event_code' in payload, false);
});

test('a test event code rides beside data, not inside the event', () => {
  const payload = buildMessagingConversionPayload({ ...BASE, testEventCode: 'TEST12345' });

  assert.equal(payload.test_event_code, 'TEST12345');
  assert.equal('test_event_code' in payload.data[0], false);
  // Everything else is unchanged, so what we verify is what we send.
  assert.equal(payload.data[0].action_source, 'business_messaging');
  assert.equal(payload.data[0].user_data.ctwa_clid, BASE.clickId);
});

test('a blank test event code is treated as absent', () => {
  for (const blank of ['', '   ', null, undefined]) {
    const payload = buildMessagingConversionPayload({ ...BASE, testEventCode: blank });
    assert.equal('test_event_code' in payload, false, `blank: ${JSON.stringify(blank)}`);
  }
});

test("Meta refusing the placeholder click id is not an integration failure", () => {
  // Verbatim from the live dataset, which is the only way to be sure the
  // subcode is read from where Meta actually puts it.
  const body = JSON.stringify({
    error: {
      message: 'Invalid parameter',
      type: 'OAuthException',
      code: 100,
      error_subcode: 2804087,
      error_user_title: 'Messaging Event Invalid Ctwa Clid',
    },
  });

  assert.equal(isPlaceholderClickIdRejection(body), true);
});

test('a wrong dataset id or a refused token is still a failure', () => {
  const badDataset = JSON.stringify({
    error: { message: 'Unsupported post request.', code: 100, error_subcode: 33 },
  });
  const badToken = JSON.stringify({
    error: { message: 'Invalid OAuth access token.', code: 190 },
  });

  assert.equal(isPlaceholderClickIdRejection(badDataset), false);
  assert.equal(isPlaceholderClickIdRejection(badToken), false);
  // A body that is not JSON at all must not read as success.
  assert.equal(isPlaceholderClickIdRejection('<html>502</html>'), false);
  assert.equal(isPlaceholderClickIdRejection(''), false);
});
