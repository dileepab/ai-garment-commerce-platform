import prisma from '@/lib/prisma';
import { logInfo, logWarn } from '@/lib/app-log';
import { resolveWhatsAppConfigForBrand } from '@/lib/brand-channel-config';
import {
  buildMessagingConversionPayload,
  isWithinAttributionWindow,
  type MessagingConversionInput,
} from '@/lib/meta-conversions-payload';

/**
 * Sends conversions back to Meta for Click-to-WhatsApp ads.
 *
 * Nothing here is allowed to affect an order. A reporting call that fails must
 * leave the customer with their order and the operator with their record; the
 * only consequence of a failure is a line in the log.
 *
 * That log line matters more than usual. A silently unconfigured integration
 * looks identical to one that is working and simply has no sales yet, and the
 * whole point of this is to stop flying blind — so a missing dataset id, a
 * refused token and a rejected event each say so explicitly.
 */

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

function datasetId(): string {
  return (process.env.META_CONVERSIONS_DATASET_ID || '').trim();
}

/**
 * Present only while proving the pipeline works.
 *
 * Meta routes an event carrying this code to the Test Events tab and never
 * credits it to an ad, so leaving it set in production would silently stop
 * every real sale from counting. Unset it once a live event has landed.
 */
function testEventCode(): string {
  return (process.env.META_CONVERSIONS_TEST_EVENT_CODE || '').trim();
}

export function isConversionsApiConfigured(): boolean {
  return Boolean(datasetId());
}

/**
 * The token used to post events. A dedicated one is preferred; the WhatsApp
 * system-user token is the fallback because it is the one already in place,
 * and it carries the permissions when it was issued for the same business.
 */
function conversionsAccessToken(whatsappToken?: string | null): string {
  return (process.env.META_CONVERSIONS_ACCESS_TOKEN || '').trim() || (whatsappToken || '').trim();
}

export interface OrderConversionInput {
  orderId: number;
  brand?: string | null;
  totalAmount: number;
  adClickId?: string | null;
  /** When the ad was clicked, for the seven-day window. */
  clickedAt?: Date | null;
  currency?: string;
}

/**
 * Reports a paid order against the ad that produced it.
 *
 * Returns what happened rather than throwing, so the caller can log it beside
 * the order without a try/catch of its own.
 */
export async function reportOrderConversion(
  input: OrderConversionInput
): Promise<{ sent: boolean; reason?: string }> {
  const clickId = input.adClickId?.trim();
  // An organic order is not a failure; most orders will land here.
  if (!clickId) return { sent: false, reason: 'no_click_id' };

  const dataset = datasetId();
  if (!dataset) {
    logWarn('Meta Conversions', 'An ad-attributed order was not reported: no dataset id configured.', {
      orderId: input.orderId,
    });
    return { sent: false, reason: 'not_configured' };
  }

  if (input.clickedAt && !isWithinAttributionWindow(input.clickedAt)) {
    logInfo('Meta Conversions', 'Ad-attributed order is outside the seven-day window Meta credits.', {
      orderId: input.orderId,
    });
    return { sent: false, reason: 'outside_window' };
  }

  const config = input.brand ? await resolveWhatsAppConfigForBrand(input.brand) : null;
  const businessAccountId = config?.businessAccountId?.trim();
  if (!businessAccountId) {
    logWarn('Meta Conversions', 'An ad-attributed order was not reported: no WhatsApp business account id.', {
      orderId: input.orderId,
      brand: input.brand || 'unknown',
    });
    return { sent: false, reason: 'no_waba_id' };
  }

  const accessToken = conversionsAccessToken(config?.accessToken);
  if (!accessToken) {
    logWarn('Meta Conversions', 'An ad-attributed order was not reported: no access token.', {
      orderId: input.orderId,
    });
    return { sent: false, reason: 'no_token' };
  }

  const payload = buildMessagingConversionPayload({
    eventName: 'Purchase',
    clickId,
    whatsappBusinessAccountId: businessAccountId,
    currency: input.currency || 'LKR',
    value: input.totalAmount,
    // The order id, so a retry is deduplicated rather than counted twice.
    eventId: `order-${input.orderId}`,
    eventTime: new Date(),
    testEventCode: testEventCode() || null,
  } satisfies MessagingConversionInput);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(dataset)}/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await response.text();

    if (!response.ok) {
      logWarn('Meta Conversions', 'Meta rejected the purchase event.', {
        orderId: input.orderId,
        status: response.status,
        // Meta's error body names the offending field, which is the only way
        // to tell a bad dataset id from a bad token.
        response: text.slice(0, 300),
      });
      return { sent: false, reason: `rejected_${response.status}` };
    }

    logInfo('Meta Conversions', 'Reported a purchase from a Click-to-WhatsApp ad.', {
      orderId: input.orderId,
      brand: input.brand || 'unknown',
      value: input.totalAmount,
      // Says plainly that this sale went to Test Events and was not credited,
      // so a log full of successes is not mistaken for a working funnel.
      ...(testEventCode() ? { testEventOnly: true } : {}),
    });
    return { sent: true };
  } catch (error) {
    logWarn('Meta Conversions', 'Could not reach Meta to report the purchase.', {
      orderId: input.orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: 'network_error' };
  }
}

export interface ConversionsConfigurationReport {
  present: Record<string, boolean>;
  /** Last four digits only, so the dataset can be told apart without exposing it. */
  datasetIdSuffix: string;
  /** Set means every sale goes to Test Events and is credited to nothing. */
  testEventCodeActive: boolean;
}

/**
 * What is actually configured, without revealing any of it.
 *
 * A variable that exists but holds an empty string is indistinguishable from
 * a missing one in the dashboard, and that is exactly how a whole feature can
 * sit dead for days looking correctly configured.
 */
export function describeConversionsConfiguration(): ConversionsConfigurationReport {
  const dataset = datasetId();
  return {
    present: {
      META_CONVERSIONS_DATASET_ID: Boolean(dataset),
      META_CONVERSIONS_ACCESS_TOKEN: Boolean((process.env.META_CONVERSIONS_ACCESS_TOKEN || '').trim()),
    },
    datasetIdSuffix: dataset ? dataset.slice(-4) : '',
    testEventCodeActive: Boolean(testEventCode()),
  };
}

/**
 * Meta validates this and refuses it, which is the point: the refusal proves
 * the request got past the dataset lookup and the token check to reach field
 * validation, without inventing a sale against a real ad.
 */
const PLACEHOLDER_CLICK_ID = 'verification-not-a-real-click';

/**
 * Posts one synthetic Purchase so the credentials can be proven before a real
 * sale depends on them.
 *
 * The click id is deliberately not a real one: Meta accepts the event and
 * credits it to no ad, so running this can never change what a campaign
 * reports. The value is zero for the same reason.
 */
export async function sendVerificationEvent(
  brand: string,
  clickId?: string | null
): Promise<{ ok: boolean; status: number; response: string; reason?: string }> {
  const dataset = datasetId();
  if (!dataset) return { ok: false, status: 0, response: '', reason: 'no_dataset_id' };

  const config = await resolveWhatsAppConfigForBrand(brand);
  const businessAccountId = config?.businessAccountId?.trim();
  if (!businessAccountId) return { ok: false, status: 0, response: '', reason: 'no_waba_id' };

  const accessToken = conversionsAccessToken(config?.accessToken);
  if (!accessToken) return { ok: false, status: 0, response: '', reason: 'no_token' };

  const payload = buildMessagingConversionPayload({
    eventName: 'Purchase',
    clickId: clickId?.trim() || PLACEHOLDER_CLICK_ID,
    whatsappBusinessAccountId: businessAccountId,
    currency: 'LKR',
    value: 0,
    eventId: `verify-${Date.now()}`,
    eventTime: new Date(),
    testEventCode: testEventCode() || null,
  } satisfies MessagingConversionInput);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(dataset)}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      }
    );
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      // Meta's error body names the offending field, which is the only way to
      // tell a wrong dataset id from a token that cannot write to it.
      response: text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      response: error instanceof Error ? error.message : String(error),
      reason: 'network_error',
    };
  }
}

/**
 * Looks the order's attribution up and reports it.
 *
 * Split from the sender so the caller only needs an order id, and so nothing
 * about reporting has to be threaded through order creation.
 */
export async function reportOrderConversionById(orderId: number): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, brand: true, totalAmount: true, adClickId: true },
    });
    if (!order?.adClickId) return;

    const referral = await prisma.adReferral.findFirst({
      where: { clickId: order.adClickId },
      select: { capturedAt: true },
    });

    await reportOrderConversion({
      orderId: order.id,
      brand: order.brand,
      totalAmount: order.totalAmount,
      adClickId: order.adClickId,
      clickedAt: referral?.capturedAt ?? null,
    });
  } catch (error) {
    logWarn('Meta Conversions', 'Could not report the order conversion.', {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
