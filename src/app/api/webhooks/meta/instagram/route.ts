import { NextResponse } from 'next/server';
import {
  sendMessengerCarousel,
  sendMessengerImage,
  sendMessengerMessage,
  type MetaSendResult,
} from '@/lib/meta';
import { sendInstagramCommentReply, sendInstagramPrivateReply } from '@/lib/meta-comments';
import { getErrorMessage } from '@/lib/error-message';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import { logDebug, logError, logInfo, logWarn } from '@/lib/app-log';
import { getMerchantSettings, logRuntimeWarnings } from '@/lib/runtime-config';
import {
  normalizeInstagramComment,
  normalizeInstagramEvent,
  type NormalizedMessage,
} from '@/lib/meta-normalize';
import { getAiCommentReply } from '@/lib/ai';
import {
  buildHumanSupportReply,
  buildSupportConversationSummary,
  upsertSupportEscalation,
} from '@/lib/customer-support';
import type { CustomerMessageResult } from '@/lib/chat/contracts';
import {
  claimWebhookEvent,
  countRecentWebhookFailures,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '@/lib/webhook-event-log';
import prisma from '@/lib/prisma';

const IS_CHAT_TEST_MODE = process.env.CHAT_TEST_MODE === '1';
const FAILURE_ESCALATION_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_ESCALATION_THRESHOLD = 2;

type InstagramCommentChangeInput = Parameters<typeof normalizeInstagramComment>[0];

interface WebhookStats {
  received: number;
  normalized: number;
  skipped: number;
  duplicates: number;
  processed: number;
  failed: number;
  deliveryFailures: number;
  escalated: number;
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
    escalated: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function truncateForLog(value: string | null, maxLength = 80): string | null {
  if (!value) {
    return null;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function describeMetaResult(result: MetaSendResult): string {
  return result.error || (result.status ? `Meta Graph returned ${result.status}.` : 'Unknown delivery failure.');
}

function summarizeMessagingEvent(webhookEvent: Record<string, unknown>, accountId: string) {
  const message =
    typeof webhookEvent.message === 'object' && webhookEvent.message !== null
      ? (webhookEvent.message as Record<string, unknown>)
      : null;
  const postback =
    typeof webhookEvent.postback === 'object' && webhookEvent.postback !== null
      ? (webhookEvent.postback as Record<string, unknown>)
      : null;
  const senderId =
    typeof webhookEvent.sender === 'object' &&
    webhookEvent.sender !== null &&
    'id' in webhookEvent.sender &&
    typeof webhookEvent.sender.id === 'string'
      ? webhookEvent.sender.id
      : null;
  const messageText =
    message && typeof message.text === 'string'
      ? truncateForLog(message.text)
      : null;

  return {
    senderId,
    senderMatchesAccount: senderId === accountId,
    hasMessage: Boolean(message),
    hasPostback: Boolean(postback),
    messageText,
    keys: Object.keys(webhookEvent),
  };
}

function getInstagramBrand(accountId: string): string | null {
  const IG_BRAND_MAP: Record<string, string> = {};

  if (process.env.CLEOPATRA_INSTAGRAM_ID) IG_BRAND_MAP[process.env.CLEOPATRA_INSTAGRAM_ID] = 'Cleopatra';
  if (process.env.MODABELLA_INSTAGRAM_ID) IG_BRAND_MAP[process.env.MODABELLA_INSTAGRAM_ID] = 'Modabella';
  if (process.env.HAPPYBY_INSTAGRAM_ID) IG_BRAND_MAP[process.env.HAPPYBY_INSTAGRAM_ID] = 'Happyby';

  return IG_BRAND_MAP[accountId] || null;
}

async function deliverCustomerResult(
  senderId: string,
  result: CustomerMessageResult,
  stats: WebhookStats
) {
  if (IS_CHAT_TEST_MODE || !result.reply) {
    return;
  }

  const failures: string[] = [];
  const messageResult = await sendMessengerMessage(senderId, result.reply);

  if (!messageResult.ok) {
    failures.push(`text: ${describeMetaResult(messageResult)}`);
  }

  if (result.carouselProducts && result.carouselProducts.length > 0) {
    const carouselResult = await sendMessengerCarousel(senderId, result.carouselProducts);

    if (!carouselResult.ok) {
      logWarn('Instagram Webhook', 'Instagram rejected carousel delivery; continuing with text reply.', {
        senderId,
        error: describeMetaResult(carouselResult),
      });
      stats.deliveryFailures += 1;
    }
  } else if (result.imagePaths?.length) {
    for (const imagePath of result.imagePaths) {
      const imageResult = await sendMessengerImage(senderId, imagePath);

      if (!imageResult.ok) {
        failures.push(`image ${imagePath}: ${describeMetaResult(imageResult)}`);
      }
    }
  } else if (result.imagePath) {
    const imageResult = await sendMessengerImage(senderId, result.imagePath);

    if (!imageResult.ok) {
      failures.push(`image ${result.imagePath}: ${describeMetaResult(imageResult)}`);
    }
  }

  if (failures.length > 0) {
    stats.deliveryFailures += failures.length;
    throw new Error(`Instagram delivery failed (${failures.join('; ')})`);
  }
}

async function escalateRepeatedFailure(params: {
  normalized: NormalizedMessage;
  brand?: string;
  error: unknown;
  stats: WebhookStats;
}) {
  const failureCount = await countRecentWebhookFailures({
    channel: params.normalized.channel,
    senderId: params.normalized.senderId,
    withinMs: FAILURE_ESCALATION_WINDOW_MS,
  });

  if (failureCount < FAILURE_ESCALATION_THRESHOLD) {
    if (!IS_CHAT_TEST_MODE) {
      const settings = await getMerchantSettings(params.brand);
      const fallbackReply = settings.support.processingErrorMessage;
      const delivery = await sendMessengerMessage(params.normalized.senderId, fallbackReply);

      if (!delivery.ok) {
        params.stats.deliveryFailures += 1;
        logWarn('Instagram Webhook', 'Could not send Instagram processing-failure fallback.', {
          senderId: params.normalized.senderId,
          eventId: params.normalized.eventId,
          error: describeMetaResult(delivery),
        });
      }
    }

    return;
  }

  await upsertSupportEscalation({
    senderId: params.normalized.senderId,
    channel: params.normalized.channel,
    customerId: null,
    orderId: null,
    brand: params.brand || null,
    contactName: null,
    contactPhone: null,
    latestCustomerMessage: params.normalized.messageText,
    reason: 'unclear_request',
    summary: `${buildSupportConversationSummary({
      reason: 'unclear_request',
      currentMessage: params.normalized.messageText,
      recentMessages: [],
      orderId: null,
    })}\n\nAutomation failure: ${getErrorMessage(params.error)}`,
  });
  params.stats.escalated += 1;

  if (!IS_CHAT_TEST_MODE) {
    const settings = await getMerchantSettings(params.brand);
    const delivery = await sendMessengerMessage(
      params.normalized.senderId,
      buildHumanSupportReply({
        reason: 'unclear_request',
        supportConfig: settings.support,
      })
    );

    if (!delivery.ok) {
      params.stats.deliveryFailures += 1;
      logWarn('Instagram Webhook', 'Could not send Instagram support-escalation fallback.', {
        senderId: params.normalized.senderId,
        eventId: params.normalized.eventId,
        error: describeMetaResult(delivery),
      });
    }
  }
}

async function processInstagramEvent(params: {
  webhookEvent: Record<string, unknown>;
  accountId: string;
  brand: string | null;
  stats: WebhookStats;
}) {
  params.stats.received += 1;
  logDebug(
    'Instagram Webhook',
    `Account ${params.brand || 'unknown'} received a raw messaging event.`,
    summarizeMessagingEvent(params.webhookEvent, params.accountId)
  );

  const normalized = normalizeInstagramEvent(params.webhookEvent, params.accountId);

  if (!normalized) {
    params.stats.skipped += 1;
    logDebug(
      'Instagram Webhook',
      `Skipped Instagram event for account ${params.brand || 'unknown'} because it did not normalize.`,
      summarizeMessagingEvent(params.webhookEvent, params.accountId)
    );
    return;
  }

  params.stats.normalized += 1;
  const claim = await claimWebhookEvent({
    eventId: normalized.eventId,
    channel: normalized.channel,
    eventType: normalized.isPostback ? 'postback' : 'message',
    senderId: normalized.senderId,
    pageOrAccountId: normalized.pageOrAccountId,
    brand: params.brand,
  });

  if (claim.duplicate) {
    params.stats.duplicates += 1;
    logInfo('Instagram Webhook', 'Skipped duplicate Instagram event.', {
      senderId: normalized.senderId,
      eventId: normalized.eventId,
    });
    return;
  }

  try {
    logInfo('Instagram Webhook', 'Processing Instagram event.', {
      senderId: normalized.senderId,
      eventId: normalized.eventId,
      brand: params.brand || 'unknown',
      hasImage: Boolean(normalized.imageUrl),
      isPostback: normalized.isPostback,
    });

    const result = await routeCustomerMessage({
      senderId: normalized.senderId,
      channel: normalized.channel,
      currentMessage: normalized.messageText,
      brand: params.brand || undefined,
      imageUrl: normalized.imageUrl,
    });

    await deliverCustomerResult(normalized.senderId, result, params.stats);
    await markWebhookEventProcessed(normalized.eventId);
    params.stats.processed += 1;
  } catch (error: unknown) {
    params.stats.failed += 1;
    logError('Instagram Webhook', 'Instagram event processing failed.', {
      senderId: normalized.senderId,
      eventId: normalized.eventId,
      error: getErrorMessage(error),
    });
    await markWebhookEventFailed(normalized.eventId, error).catch((logErrorValue) => {
      logError('Instagram Webhook', 'Could not mark Instagram event failed.', logErrorValue);
    });
    await escalateRepeatedFailure({
      normalized,
      brand: params.brand || undefined,
      error,
      stats: params.stats,
    }).catch((escalationError) => {
      logError('Instagram Webhook', 'Could not escalate repeated Instagram failure.', escalationError);
    });
  }
}

async function processInstagramCommentChange(params: {
  changeValue: InstagramCommentChangeInput;
  accountId: string;
  brand: string | null;
  stats: WebhookStats;
}) {
  params.stats.received += 1;
  const normalized = normalizeInstagramComment(params.changeValue, params.accountId);

  if (!normalized) {
    params.stats.skipped += 1;
    return;
  }

  params.stats.normalized += 1;
  const eventId = `instagram:${params.accountId}:comment:${normalized.commentId}`;
  const claim = await claimWebhookEvent({
    eventId,
    channel: 'instagram',
    eventType: 'comment',
    senderId: normalized.senderId,
    pageOrAccountId: normalized.pageOrAccountId,
    brand: params.brand,
  });

  if (claim.duplicate) {
    params.stats.duplicates += 1;
    logInfo('Instagram Webhook', 'Skipped duplicate Instagram comment event.', {
      commentId: normalized.commentId,
      eventId,
    });
    return;
  }

  try {
    const existingLog = await prisma.commentLog.findUnique({
      where: { id: normalized.commentId },
    });

    if (existingLog) {
      params.stats.duplicates += 1;
      await markWebhookEventProcessed(eventId, 'skipped');
      logDebug('Instagram Webhook', `Already processed comment ${normalized.commentId}. Skipping.`);
      return;
    }

    logInfo('Instagram Webhook', 'Processing Instagram comment.', {
      commentId: normalized.commentId,
      brand: params.brand || 'unknown',
      messagePreview: truncateForLog(normalized.message),
    });

    const replyText = await getAiCommentReply(normalized.message, params.brand || undefined);
    const publicResult = IS_CHAT_TEST_MODE
      ? ({ ok: true } satisfies MetaSendResult)
      : await sendInstagramCommentReply(normalized.commentId, replyText);
    const privateResult = IS_CHAT_TEST_MODE
      ? ({ ok: true } satisfies MetaSendResult)
      : await sendInstagramPrivateReply(normalized.commentId, params.accountId, replyText);

    if (publicResult.ok || privateResult.ok) {
      await prisma.commentLog.create({
        data: {
          id: normalized.commentId,
          channel: 'instagram',
          brand: params.brand || null,
        },
      });
    }

    if (!publicResult.ok || !privateResult.ok) {
      params.stats.deliveryFailures += Number(!publicResult.ok) + Number(!privateResult.ok);
      throw new Error(
        `Instagram comment delivery failed. Public: ${describeMetaResult(publicResult)} Private: ${describeMetaResult(privateResult)}`
      );
    }

    await markWebhookEventProcessed(eventId);
    params.stats.processed += 1;
  } catch (error: unknown) {
    params.stats.failed += 1;
    logError('Instagram Webhook', 'Instagram comment processing failed.', {
      eventId,
      commentId: normalized.commentId,
      error: getErrorMessage(error),
    });
    await markWebhookEventFailed(eventId, error).catch((logErrorValue) => {
      logError('Instagram Webhook', 'Could not mark Instagram comment failed.', logErrorValue);
    });
  }
}

export async function GET(request: Request) {
  logRuntimeWarnings('Instagram Webhook');
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  if (!VERIFY_TOKEN) {
    logError('Instagram Webhook', 'Verification failed because META_VERIFY_TOKEN is not configured.');
    return new NextResponse('Webhook verify token is not configured.', { status: 500 });
  }

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logInfo('Instagram Webhook', 'Verification successful.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      logError('Instagram Webhook', 'Verification failed.');
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  return new NextResponse('Bad Request', { status: 400 });
}

export async function POST(request: Request) {
  logRuntimeWarnings('Instagram Webhook');
  const stats = createStats();
  const startedAt = Date.now();

  let body: unknown;

  try {
    body = await request.json();
  } catch (error: unknown) {
    logError('Instagram Webhook', 'Invalid webhook JSON payload.', error);
    return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (!isRecord(body) || body.object !== 'instagram') {
    return NextResponse.json({ success: false }, { status: 404 });
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];

  logInfo('Instagram Webhook', 'Received Instagram webhook batch.', {
    object: body.object,
    entryCount: entries.length,
  });

  for (const entry of entries) {
    if (!isRecord(entry)) {
      stats.skipped += 1;
      continue;
    }

    const accountId = typeof entry.id === 'string' ? entry.id : '';
    const brand = getInstagramBrand(accountId);
    const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const webhookEvent of messagingEvents) {
      if (!isRecord(webhookEvent)) {
        stats.skipped += 1;
        continue;
      }

      await processInstagramEvent({
        webhookEvent,
        accountId,
        brand,
        stats,
      }).catch((error: unknown) => {
        stats.failed += 1;
        logError('Instagram Webhook', 'Instagram event failed before processing could start.', {
          accountId,
          brand: brand || 'unknown',
          error: getErrorMessage(error),
        });
      });
    }

    for (const change of changes) {
      if (!isRecord(change) || !isRecord(change.value)) {
        stats.skipped += 1;
        continue;
      }

      await processInstagramCommentChange({
        changeValue: change.value as unknown as InstagramCommentChangeInput,
        accountId,
        brand,
        stats,
      }).catch((error: unknown) => {
        stats.failed += 1;
        logError('Instagram Webhook', 'Instagram comment failed before processing could start.', {
          accountId,
          brand: brand || 'unknown',
          error: getErrorMessage(error),
        });
      });
    }
  }

  logInfo('Instagram Webhook', 'Completed Instagram webhook batch.', {
    ...stats,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      success: stats.failed === 0,
      message: 'EVENT_RECEIVED',
      stats,
    },
    { status: 200 }
  );
}
