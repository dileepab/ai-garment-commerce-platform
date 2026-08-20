import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildMessagingConversionPayload,
  isWithinAttributionWindow,
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
