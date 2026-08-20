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
