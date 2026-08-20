/**
 * The Purchase event that tells Meta an ad produced a sale.
 *
 * Without this the algorithm has never been shown a buyer. Optimising a
 * Click-to-WhatsApp campaign for "messaging conversations started" buys the
 * cheapest people who will send a message, which is how an inbox fills with
 * "Hi" and a thumbs-up while the orders table stays empty. Meta can only
 * optimise for buyers once it has been told who bought.
 *
 * The click id is the whole point: an event without it is accepted and then
 * not associated with any ad, so the campaign learns nothing from it.
 *
 * Kept free of path aliases so it can be tested.
 */

/** Meta discards an event tied to a click older than this. */
export const CTWA_ATTRIBUTION_WINDOW_DAYS = 7;

export interface MessagingConversionInput {
  eventName: 'Purchase' | 'Lead' | 'InitiateCheckout';
  /** From the ad referral stored when the customer first messaged. */
  clickId: string;
  whatsappBusinessAccountId: string;
  currency: string;
  value: number;
  /** Meta deduplicates on event name plus this, so retries cost nothing. */
  eventId: string;
  eventTime: Date;
}

export interface MessagingConversionPayload {
  data: Array<{
    event_name: string;
    event_time: number;
    action_source: 'business_messaging';
    messaging_channel: 'whatsapp';
    event_id: string;
    user_data: {
      whatsapp_business_account_id: string;
      ctwa_clid: string;
    };
    custom_data: {
      currency: string;
      value: number;
    };
  }>;
}

export function buildMessagingConversionPayload(
  input: MessagingConversionInput
): MessagingConversionPayload {
  return {
    data: [
      {
        event_name: input.eventName,
        // Seconds, not milliseconds. Meta rejects the millisecond form as a
        // timestamp far in the future.
        event_time: Math.floor(input.eventTime.getTime() / 1000),
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        event_id: input.eventId,
        user_data: {
          whatsapp_business_account_id: input.whatsappBusinessAccountId,
          ctwa_clid: input.clickId,
        },
        custom_data: {
          currency: input.currency,
          value: input.value,
        },
      },
    ],
  };
}

/**
 * Whether the click is still inside the window Meta will credit.
 *
 * The referral is kept for thirty days so an order can be attributed in our
 * own reporting, but Meta only credits seven, and sending an event it will
 * discard just makes the delivery log harder to read.
 */
export function isWithinAttributionWindow(
  clickedAt: Date,
  now: Date = new Date()
): boolean {
  const ageMs = now.getTime() - clickedAt.getTime();
  if (Number.isNaN(ageMs) || ageMs < 0) return false;
  return ageMs <= CTWA_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
