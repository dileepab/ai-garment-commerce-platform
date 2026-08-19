import { NextResponse } from 'next/server';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import {
  resolveBrandForWhatsAppPhoneNumberId,
  resolveWhatsAppConfigForPhoneNumberId,
  type ResolvedWhatsAppConfig,
} from '@/lib/brand-channel-config';
import { recordAdReferral } from '@/lib/ad-referral';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { logError, logInfo, logWarn } from '@/lib/app-log';
import { logRuntimeWarnings } from '@/lib/runtime-config';
import { verifyMetaWebhookSignature } from '@/lib/meta-webhook-signature';
import { buildProductListPayload } from '@/lib/whatsapp-product-message';
import {
  extractWhatsAppWebhook,
  type ExtractedWhatsAppMessage,
} from '@/lib/whatsapp-normalize';
import {
  downloadWhatsAppImageAsDataUrl,
  sendWhatsAppImage,
  sendWhatsAppMessage,
  sendWhatsAppPayloadMessage,
} from '@/lib/whatsapp';
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '@/lib/webhook-event-log';
import type { CustomerMessageResult } from '@/lib/chat/contracts';
import { storeInboundChatImage } from '@/lib/chat/inbound-image-store';

const IS_CHAT_TEST_MODE = process.env.CHAT_TEST_MODE === '1';

interface WebhookStats {
  received: number;
  normalized: number;
  skipped: number;
  duplicates: number;
  processed: number;
  failed: number;
  deliveryFailures: number;
  statuses: number;
}

function createStats(): WebhookStats {
  return {
    received: 0,
    normalized: 0,
    skipped: 0,
    duplicates: 0,
    processed: 0,
    failed: 0,
    deliveryFailures: 0,
    statuses: 0,
  };
}

function describeResult(result: { error?: string; status?: number }): string {
  return result.error || (result.status ? `Meta Graph returned ${result.status}.` : 'Unknown delivery failure.');
}

function buildCatalogText(products: NonNullable<CustomerMessageResult['carouselProducts']>): string {
  return [
    'Available items:',
    ...products.slice(0, 10).map((product, index) =>
      `${index + 1}. ${product.name} — Rs ${product.price.toLocaleString('en-LK')}\nSizes: ${product.sizes} | Colors: ${product.colors}`
    ),
    '',
    'Reply with the item name to see its details or place an order.',
  ].join('\n');
}

async function deliverCustomerResult(
  senderId: string,
  result: CustomerMessageResult,
  config: ResolvedWhatsAppConfig,
  stats: WebhookStats
) {
  if (IS_CHAT_TEST_MODE) return;

  const options = {
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    quickReplies: result.quickReplies,
  };

  if (result.reply) {
    const delivery = await sendWhatsAppMessage(senderId, result.reply, options);
    if (!delivery.ok) {
      stats.deliveryFailures += 1;
      throw new Error(`WhatsApp text delivery failed (${describeResult(delivery)})`);
    }
  }

  if (result.carouselProducts?.length) {
    // A card carries the catalog image, price and an Add to cart button, so the
    // customer can act on a recommendation without leaving the chat. Falls back
    // to the text list when the brand has no catalog, or when nothing in the
    // reply has a sellable variant to point at.
    const productPayload = config.catalogId
      ? buildProductListPayload({
          recipient: senderId,
          catalogId: config.catalogId,
          header: 'Available now',
          body: 'Tap an item to see sizes, prices and add it to your cart.',
          sections: [
            {
              title: 'Available now',
              products: result.carouselProducts
                .filter((product) => product.retailerId)
                .map((product) => ({ retailerId: product.retailerId! })),
            },
          ],
        })
      : null;

    const delivery = productPayload
      ? await sendWhatsAppPayloadMessage(productPayload, {
          phoneNumberId: config.phoneNumberId,
          accessToken: config.accessToken,
        })
      : await sendWhatsAppMessage(
          senderId,
          buildCatalogText(result.carouselProducts),
          { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken }
        );

    if (!delivery.ok) {
      stats.deliveryFailures += 1;
      throw new Error(`WhatsApp catalog delivery failed (${describeResult(delivery)})`);
    }
    return;
  }

  const imagePaths = result.imagePaths?.length
    ? result.imagePaths
    : result.imagePath
      ? [result.imagePath]
      : [];

  for (const [index, imagePath] of imagePaths.entries()) {
    // Photographs arrive as separate messages after the text, so when several
    // products are being shown the caption is the only thing tying each
    // picture to the dress it belongs to.
    const caption = result.imageCaptions?.[index]?.trim() || undefined;
    const delivery = await sendWhatsAppImage(
      senderId,
      imagePath,
      {
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
      },
      caption
    );
    if (!delivery.ok) {
      stats.deliveryFailures += 1;
      logWarn('WhatsApp Webhook', 'Text reply succeeded but image delivery failed.', {
        senderId,
        imagePath,
        error: describeResult(delivery),
      });
    }
  }
}

async function processMessage(
  extracted: ExtractedWhatsAppMessage,
  stats: WebhookStats
) {
  const normalized = extracted.message;
  stats.received += 1;
  const config = await resolveWhatsAppConfigForPhoneNumberId(normalized.pageOrAccountId);
  const brand = config?.brand ?? await resolveBrandForWhatsAppPhoneNumberId(normalized.pageOrAccountId);
  const claim = await claimWebhookEvent({
    eventId: normalized.eventId,
    channel: 'whatsapp',
    eventType: normalized.isPostback ? 'postback' : 'message',
    senderId: normalized.senderId,
    pageOrAccountId: normalized.pageOrAccountId,
    brand,
  });

  if (!claim.claimed) {
    stats.duplicates += 1;
    return;
  }

  if (!config || !brand) {
    stats.skipped += 1;
    await markWebhookEventProcessed(normalized.eventId, 'skipped');
    logWarn('WhatsApp Webhook', 'Skipped message for an unconfigured Phone Number ID.', {
      phoneNumberId: normalized.pageOrAccountId,
      senderId: normalized.senderId,
    });
    return;
  }

  stats.normalized += 1;

  // A Click-to-WhatsApp ad names itself only on this first message and never
  // again, so it is stored now and read back when the order is finally placed.
  // Failing to record it must never cost the customer a reply — attribution is
  // reporting, the conversation is the business.
  if (normalized.adReferral) {
    try {
      await recordAdReferral(prisma, {
        channel: 'whatsapp',
        senderId: normalized.senderId,
        ...normalized.adReferral,
      });
    } catch (error) {
      logWarn('WhatsApp Webhook', 'Could not record the ad referral for this conversation.', {
        senderId: normalized.senderId,
        error: getErrorMessage(error),
      });
    }
  }

  try {
    const imageUrl = normalized.mediaId
      ? await downloadWhatsAppImageAsDataUrl(normalized.mediaId, config.accessToken)
      : undefined;
    const result = await routeCustomerMessage({
      senderId: normalized.senderId,
      channel: 'whatsapp',
      currentMessage: normalized.messageText,
      // A bare photo is routed as a presumed question; the transcript records
      // that they sent a photo and no words.
      transcriptMessage: normalized.messageTextInferred ? '' : undefined,
      brand,
      customerName: extracted.customerName,
      imageUrl: imageUrl ?? undefined,
      // Gemini reads the data URL above; the inbox needs one that still
      // resolves next week.
      storedImageUrl:
        (await storeInboundChatImage({ source: imageUrl, channel: 'whatsapp' })) ?? undefined,
      // Exact catalog rows the customer chose, so the draft is built from what
      // they actually added rather than inferred from conversation text.
      cart: normalized.cart?.items.map((item) => ({
        retailerId: item.retailerId,
        quantity: item.quantity,
      })),
    });

    await deliverCustomerResult(normalized.senderId, result, config, stats);
    await markWebhookEventProcessed(normalized.eventId);
    stats.processed += 1;
  } catch (error) {
    stats.failed += 1;
    await markWebhookEventFailed(normalized.eventId, error).catch((markError) => {
      logError('WhatsApp Webhook', 'Could not mark WhatsApp event failed.', markError);
    });
    logError('WhatsApp Webhook', 'Message processing failed.', {
      eventId: normalized.eventId,
      senderId: normalized.senderId,
      brand,
      error: getErrorMessage(error),
    });
  }
}

export async function GET(request: Request) {
  logRuntimeWarnings('WhatsApp Webhook');
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const verifyToken = process.env.META_VERIFY_TOKEN;

  if (!verifyToken) {
    return new NextResponse('Webhook verify token is not configured.', { status: 500 });
  }
  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse(mode && token ? 'Forbidden' : 'Bad Request', {
    status: mode && token ? 403 : 400,
  });
}

export async function POST(request: Request) {
  logRuntimeWarnings('WhatsApp Webhook');
  const stats = createStats();
  const startedAt = Date.now();
  const rawBody = await request.text();

  if (!verifyMetaWebhookSignature(
    rawBody,
    request.headers.get('x-hub-signature-256'),
    process.env.META_APP_SECRET
  )) {
    logWarn('WhatsApp Webhook', 'Rejected webhook with an invalid Meta signature.');
    return NextResponse.json({ success: false, error: 'Invalid signature.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    logError('WhatsApp Webhook', 'Invalid webhook JSON payload.', error);
    return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || (body as { object?: unknown }).object !== 'whatsapp_business_account') {
    return NextResponse.json({ success: false }, { status: 404 });
  }

  const extracted = extractWhatsAppWebhook(body);
  stats.skipped += extracted.unsupportedMessageCount;

  for (const status of extracted.statuses) {
    const brand = await resolveBrandForWhatsAppPhoneNumberId(status.phoneNumberId);
    const claim = await claimWebhookEvent({
      eventId: status.eventId,
      channel: 'whatsapp',
      eventType: `message_status_${status.status}`,
      senderId: status.recipientId,
      pageOrAccountId: status.phoneNumberId,
      brand,
    });
    if (claim.claimed) {
      await markWebhookEventProcessed(status.eventId);
      stats.statuses += 1;
    } else {
      stats.duplicates += 1;
    }
  }

  for (const message of extracted.messages) {
    await processMessage(message, stats);
  }

  logInfo('WhatsApp Webhook', 'Completed WhatsApp webhook batch.', {
    ...stats,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ success: true, stats });
}
