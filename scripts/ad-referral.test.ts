import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AD_REFERRAL_ATTRIBUTION_DAYS,
  findOrderAdAttribution,
  recordAdReferral,
} from '../src/lib/ad-referral.ts';

type ReferralRow = {
  sourceType: string | null;
  sourceId: string | null;
  clickId: string | null;
  capturedAt: Date;
};

function stubClient(options: { row?: ReferralRow | null; failReads?: boolean } = {}) {
  const upserts: Array<Record<string, unknown>> = [];

  const client = {
    adReferral: {
      async upsert(args: Record<string, unknown>) {
        upserts.push(args);
        return args;
      },
      async findUnique() {
        if (options.failReads) throw new Error('connection lost');
        return options.row ?? null;
      },
    },
  };

  return { client, upserts };
}

const asDb = (client: unknown) => client as Parameters<typeof recordAdReferral>[0];

const CLICK = {
  channel: 'whatsapp',
  senderId: '94771234567',
  sourceType: 'ad',
  sourceId: '120210000000000',
  clickId: 'ARBxyz123',
  headline: 'Tie-Strap Smocked Sundress — Rs 1,990',
  sourceUrl: 'https://fb.me/abc',
};

test('a click is stored against the sender who made it', async () => {
  const { client, upserts } = stubClient();
  await recordAdReferral(asDb(client), CLICK);

  assert.equal(upserts.length, 1);
  const args = upserts[0] as { where: Record<string, unknown>; create: Record<string, unknown> };
  assert.deepEqual(args.where, {
    channel_senderId: { channel: 'whatsapp', senderId: '94771234567' },
  });
  assert.equal(args.create.sourceId, '120210000000000');
  assert.equal(args.create.clickId, 'ARBxyz123');
});

// A payload naming no ad and no click cannot be reconciled against spend, so
// there is nothing worth a row.
test('a referral with nothing identifying is not stored', async () => {
  const { client, upserts } = stubClient();

  await recordAdReferral(asDb(client), { channel: 'whatsapp', senderId: '9477', headline: 'Sale' });
  await recordAdReferral(asDb(client), { channel: 'whatsapp', senderId: '9477' });
  await recordAdReferral(asDb(client), { channel: 'whatsapp', senderId: '9477', sourceId: '  ' });

  assert.equal(upserts.length, 0);
});

// Someone who clicks a second ad before ordering belongs to the ad that
// actually brought them back.
test('a later click replaces the earlier one', async () => {
  const { client, upserts } = stubClient();

  await recordAdReferral(asDb(client), CLICK);
  await recordAdReferral(asDb(client), { ...CLICK, sourceId: '120299999999999', clickId: 'ARBlater' });

  const second = upserts[1] as { update: Record<string, unknown> };
  assert.equal(second.update.sourceId, '120299999999999');
  assert.equal(second.update.clickId, 'ARBlater');
});

test('an order carries the ad that started the conversation', async () => {
  const { client } = stubClient({
    row: {
      sourceType: 'ad',
      sourceId: '120210000000000',
      clickId: 'ARBxyz123',
      capturedAt: new Date('2026-08-10T09:00:00Z'),
    },
  });

  const attribution = await findOrderAdAttribution(
    asDb(client),
    'whatsapp',
    '94771234567',
    new Date('2026-08-11T09:00:00Z')
  );

  assert.deepEqual(attribution, {
    adSourceType: 'ad',
    adSourceId: '120210000000000',
    adClickId: 'ARBxyz123',
  });
});

// Otherwise a click from last year would quietly take credit for an order that
// came in organically.
test('a click older than the window is not credited', async () => {
  const capturedAt = new Date('2026-01-01T00:00:00Z');
  const { client } = stubClient({
    row: { sourceType: 'ad', sourceId: '1202', clickId: 'ARB', capturedAt },
  });

  const justInside = new Date(
    capturedAt.getTime() + (AD_REFERRAL_ATTRIBUTION_DAYS - 1) * 24 * 60 * 60 * 1000
  );
  const wellOutside = new Date(
    capturedAt.getTime() + (AD_REFERRAL_ATTRIBUTION_DAYS + 1) * 24 * 60 * 60 * 1000
  );

  assert.equal(
    (await findOrderAdAttribution(asDb(client), 'whatsapp', '9477', justInside)).adSourceId,
    '1202'
  );
  assert.deepEqual(await findOrderAdAttribution(asDb(client), 'whatsapp', '9477', wellOutside), {});
});

test('an organic conversation produces no attribution', async () => {
  const { client } = stubClient({ row: null });
  assert.deepEqual(await findOrderAdAttribution(asDb(client), 'whatsapp', '9477'), {});
});

// Attribution is reporting. It must never be the reason a customer's order
// fails to go through.
test('a database failure does not block the order', async () => {
  const { client } = stubClient({ failReads: true });
  assert.deepEqual(await findOrderAdAttribution(asDb(client), 'whatsapp', '9477'), {});
});
