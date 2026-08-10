import {
  getStructuredPostbackMessage,
  type NormalizedMessage,
} from './meta-normalize.ts';
import { extractWhatsAppCart, type WhatsAppCart } from './whatsapp-cart.ts';

interface WhatsAppContact {
  wa_id?: string;
  profile?: { name?: string };
}

/**
 * Sent on the first message after someone taps a Click-to-WhatsApp ad. It is
 * the only place the ad is ever named — WhatsApp does not repeat it on later
 * messages — so it has to be captured here or the order that follows can never
 * be tied back to the spend that produced it.
 */
interface WhatsAppReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  ctwa_clid?: string;
}

interface WhatsAppMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  referral?: WhatsAppReferral;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  button?: { payload?: string; text?: string };
}

interface WhatsAppStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: unknown[];
}

/** Which ad a conversation came from, as far as it can be identified. */
export interface WhatsAppAdReferral {
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  headline?: string;
  clickId?: string;
}

export interface NormalizedWhatsAppMessage extends NormalizedMessage {
  mediaId?: string;
  mediaMimeType?: string;
  /** Set only on the first message after a Click-to-WhatsApp ad. */
  adReferral?: WhatsAppAdReferral;
  /**
   * Set when the customer sent a catalog cart. The retailer ids name exactly
   * what they chose, so the order can be built from them rather than inferred
   * from conversation text.
   */
  cart?: WhatsAppCart;
}

export interface ExtractedWhatsAppMessage {
  message: NormalizedWhatsAppMessage;
  customerName?: string;
}

export interface ExtractedWhatsAppStatus {
  eventId: string;
  phoneNumberId: string;
  messageId: string;
  status: string;
  timestamp?: string;
  recipientId?: string;
  errors?: unknown[];
}

export interface ExtractedWhatsAppWebhook {
  messages: ExtractedWhatsAppMessage[];
  statuses: ExtractedWhatsAppStatus[];
  unsupportedMessageCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanText(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function postbackText(id?: string, title?: string, description?: string): string | null {
  return (
    getStructuredPostbackMessage(cleanText(id)) ??
    cleanText(title) ??
    cleanText(description) ??
    cleanText(id) ??
    null
  );
}

/**
 * The ad behind a conversation, or null when it did not come from one.
 *
 * An ad id or a click id is what makes the referral worth keeping; a payload
 * carrying only a headline names nothing that can be reconciled against spend.
 */
export function extractWhatsAppAdReferral(
  source: Pick<WhatsAppMessage, 'referral'>
): WhatsAppAdReferral | null {
  const referral = source.referral;
  if (!referral) return null;

  const sourceId = cleanText(referral.source_id);
  const clickId = cleanText(referral.ctwa_clid);
  if (!sourceId && !clickId) return null;

  return {
    sourceType: cleanText(referral.source_type),
    sourceId,
    sourceUrl: cleanText(referral.source_url),
    headline: cleanText(referral.headline),
    clickId,
  };
}

export function normalizeWhatsAppMessage(
  source: WhatsAppMessage,
  phoneNumberId: string
): NormalizedWhatsAppMessage | null {
  const senderId = cleanText(source.from);
  const messageId = cleanText(source.id);

  if (!senderId || !messageId || !phoneNumberId) {
    return null;
  }

  const adReferral = extractWhatsAppAdReferral(source);
  const base = {
    eventId: `whatsapp:${phoneNumberId}:${messageId}`,
    senderId,
    channel: 'whatsapp' as const,
    pageOrAccountId: phoneNumberId,
    isEcho: false,
    // Spread into every message shape below, because an ad click can land as
    // text, an image, or a catalog cart.
    ...(adReferral ? { adReferral } : {}),
  };

  // A cart is the least ambiguous thing a customer can send — they picked the
  // exact catalog rows — so it is read before the text fallbacks.
  const cart = extractWhatsAppCart(source);
  if (cart) {
    return {
      ...base,
      messageText: cart.note || 'I would like to order the items in my cart.',
      isPostback: false,
      cart,
    };
  }

  if (source.type === 'text') {
    const messageText = cleanText(source.text?.body);
    return messageText
      ? { ...base, messageText, isPostback: false }
      : null;
  }

  if (source.type === 'image') {
    const mediaId = cleanText(source.image?.id);
    if (!mediaId) return null;

    return {
      ...base,
      messageText: cleanText(source.image?.caption) ?? 'What is this item?',
      mediaId,
      mediaMimeType: cleanText(source.image?.mime_type),
      isPostback: false,
    };
  }

  if (source.type === 'interactive') {
    const buttonReply = source.interactive?.button_reply;
    const listReply = source.interactive?.list_reply;
    const id = cleanText(buttonReply?.id ?? listReply?.id);
    const messageText = postbackText(
      id,
      cleanText(buttonReply?.title ?? listReply?.title),
      cleanText(listReply?.description),
    );
    return messageText
      ? { ...base, messageText, isPostback: true, postbackPayload: id ?? messageText }
      : null;
  }

  if (source.type === 'button') {
    const payload = cleanText(source.button?.payload);
    const messageText = postbackText(payload, cleanText(source.button?.text));
    return messageText
      ? { ...base, messageText, isPostback: true, postbackPayload: payload ?? messageText }
      : null;
  }

  return null;
}

function customerNameForSender(contacts: WhatsAppContact[], senderId: string): string | undefined {
  const exact = contacts.find((contact) => cleanText(contact.wa_id) === senderId);
  return cleanText(exact?.profile?.name) ?? cleanText(contacts[0]?.profile?.name);
}

function normalizeStatus(source: WhatsAppStatus, phoneNumberId: string): ExtractedWhatsAppStatus | null {
  const messageId = cleanText(source.id);
  const status = cleanText(source.status);
  if (!messageId || !status) return null;

  const timestamp = cleanText(source.timestamp);
  return {
    eventId: ['whatsapp', phoneNumberId, messageId, 'status', status, timestamp ?? 'unknown'].join(':'),
    phoneNumberId,
    messageId,
    status,
    timestamp,
    recipientId: cleanText(source.recipient_id),
    errors: source.errors,
  };
}

export function extractWhatsAppWebhook(body: unknown): ExtractedWhatsAppWebhook {
  const output: ExtractedWhatsAppWebhook = {
    messages: [],
    statuses: [],
    unsupportedMessageCount: 0,
  };

  if (!isRecord(body) || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) {
    return output;
  }

  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== 'messages' || !isRecord(change.value)) continue;
      if (change.value.messaging_product !== 'whatsapp' || !isRecord(change.value.metadata)) continue;

      const phoneNumberId = cleanText(
        typeof change.value.metadata.phone_number_id === 'string'
          ? change.value.metadata.phone_number_id
          : undefined
      );
      if (!phoneNumberId) continue;

      const contacts = Array.isArray(change.value.contacts)
        ? change.value.contacts.filter(isRecord) as WhatsAppContact[]
        : [];
      const messages = Array.isArray(change.value.messages)
        ? change.value.messages.filter(isRecord) as WhatsAppMessage[]
        : [];

      for (const source of messages) {
        const message = normalizeWhatsAppMessage(source, phoneNumberId);
        if (!message) {
          output.unsupportedMessageCount += 1;
          continue;
        }
        output.messages.push({
          message,
          customerName: customerNameForSender(contacts, message.senderId),
        });
      }

      const statuses = Array.isArray(change.value.statuses)
        ? change.value.statuses.filter(isRecord) as WhatsAppStatus[]
        : [];
      for (const source of statuses) {
        const status = normalizeStatus(source, phoneNumberId);
        if (status) output.statuses.push(status);
      }
    }
  }

  return output;
}
