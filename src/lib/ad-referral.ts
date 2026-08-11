/**
 * Ties an order back to the ad that produced it.
 *
 * A Click-to-WhatsApp ad names itself exactly once — on the first message after
 * the click — and never again. The order arrives several messages later, after
 * size, colour and address have all been settled, by which point the payload
 * that identified the ad is long gone. So the referral is parked against the
 * sender when it arrives and read back when the order is finally created.
 *
 * Without this, spend and revenue live in two systems that share no key: Ads
 * Manager can report conversations started, and the database can report orders,
 * but nothing can say which ad paid for which order.
 *
 * Kept free of path aliases so it can be tested against a stub client.
 */
import type { PrismaClient } from '@prisma/client';

/**
 * How long a click stays creditable.
 *
 * Meta's own default is a 7-day click window. This is deliberately looser,
 * because a shopper who messages about a dress and orders it a fortnight later
 * still came from the ad — but it is bounded, so a click from last year cannot
 * quietly take credit for an organic order.
 */
export const AD_REFERRAL_ATTRIBUTION_DAYS = 30;

export interface AdReferralInput {
  channel: string;
  senderId: string;
  sourceType?: string | null;
  sourceId?: string | null;
  clickId?: string | null;
  headline?: string | null;
  sourceUrl?: string | null;
}

/** The columns copied onto an order. Empty when the sender has no live click. */
export interface OrderAdAttribution {
  adSourceType?: string | null;
  adSourceId?: string | null;
  adClickId?: string | null;
}

type AdReferralClient = Pick<PrismaClient, 'adReferral'>;

/**
 * Stores the click, replacing any earlier one.
 *
 * Last touch wins: someone who clicks a second ad before ordering is credited
 * to the ad that actually brought them back.
 */
export async function recordAdReferral(db: AdReferralClient, input: AdReferralInput): Promise<void> {
  const sourceId = input.sourceId?.trim() || null;
  const clickId = input.clickId?.trim() || null;

  // Nothing that can be reconciled against spend is not worth a row.
  if (!sourceId && !clickId) return;

  const data = {
    sourceType: input.sourceType?.trim() || null,
    sourceId,
    clickId,
    headline: input.headline?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
    capturedAt: new Date(),
  };

  await db.adReferral.upsert({
    where: { channel_senderId: { channel: input.channel, senderId: input.senderId } },
    create: { channel: input.channel, senderId: input.senderId, ...data },
    update: data,
  });
}

/**
 * The attribution to stamp on an order, or an empty object for an organic one.
 *
 * Never throws: a reporting field must not be able to block a customer's order.
 */
export async function findOrderAdAttribution(
  db: AdReferralClient,
  channel: string,
  senderId: string,
  now: Date = new Date()
): Promise<OrderAdAttribution> {
  try {
    const referral = await db.adReferral.findUnique({
      where: { channel_senderId: { channel, senderId } },
    });
    if (!referral) return {};

    const ageMs = now.getTime() - new Date(referral.capturedAt).getTime();
    if (ageMs > AD_REFERRAL_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000) return {};

    return {
      adSourceType: referral.sourceType,
      adSourceId: referral.sourceId,
      adClickId: referral.clickId,
    };
  } catch {
    return {};
  }
}
