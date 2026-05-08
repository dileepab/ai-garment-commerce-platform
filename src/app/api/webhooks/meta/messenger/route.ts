import { NextResponse } from 'next/server';
import {
  getUserProfile,
  sendMessengerCarousel,
  sendMessengerImage,
  sendMessengerMessage,
  type MetaSendResult,
} from '@/lib/meta';
import { sendFacebookCommentReply, sendFacebookPrivateReply } from '@/lib/meta-comments';
import { getErrorMessage } from '@/lib/error-message';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import { logDebug, logError, logInfo, logWarn } from '@/lib/app-log';
import { getMerchantSettings, logRuntimeWarnings } from '@/lib/runtime-config';
import {
  normalizeFacebookComment,
  normalizeMessengerEvent,
  type NormalizedMessage,
} from '@/lib/meta-normalize';
import {
  resolveBrandForFacebookPageId,
  resolveFacebookConfigForPageId,
} from '@/lib/brand-channel-config';
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

type FacebookCommentChangeInput = Parameters<typeof normalizeFacebookComment>[0];

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

function summarizeMessagingEvent(webhookEvent: Record<string, unknown>, pageId: string) {
  const message =
    typeof webhookEvent.message === 'object' && webhookEvent.message !== null
      ? (webhookEvent.message as Record<string, unknown>)
      : null;
  const postback =
    typeof webhookEvent.postback === 'object' && webhookEvent.postback !== null
      ? (webhookEvent.postback as Record<string, unknown>)
      : null;
  const quickReply =
    message &&
    typeof message.quick_reply === 'object' &&
    message.quick_reply !== null
      ? (message.quick_reply as Record<string, unknown>)
      : null;
  const senderId =
    typeof webhookEvent.sender === 'object' &&
    webhookEvent.sender !== null &&
    'id' in webhookEvent.sender &&
    typeof webhookEvent.sender.id === 'string'
      ? webhookEvent.sender.id
      : null;
  const hasMessage = Boolean(message);
  const hasPostback = Boolean(postback);
  const messageText =
    message && typeof message.text === 'string'
      ? truncateForLog(message.text)
      : null;
  const quickReplyPayload =
    quickReply && typeof quickReply.payload === 'string'
      ? truncateForLog(quickReply.payload)
      : null;
  const postbackPayload =
    postback && typeof postback.payload === 'string'
      ? truncateForLog(postback.payload)
      : null;
  const postbackTitle =
    postback && typeof postback.title === 'string'
      ? truncateForLog(postback.title)
      : null;

  return {
    senderId,
    senderMatchesPage: senderId === pageId,
    hasMessage,
    hasPostback,
    messageText,
    quickReplyPayload,
    postbackTitle,
    postbackPayload,
    keys: Object.keys(webhookEvent),
  };
}

function describeMetaResult(result: MetaSendResult): string {
  return result.error || (result.status ? `Meta Graph returned ${result.status}.` : 'Unknown delivery failure.');
}

async function deliverCustomerResult(
  senderId: string,
  result: CustomerMessageResult,
  stats: WebhookStats,
  pageAccessToken?: string
) {
  if (IS_CHAT_TEST_MODE || !result.reply) {
    return;
  }

  const failures: string[] = [];
  const metaOptions = { pageAccessToken, language: result.language };
  const messageResult = await sendMessengerMessage(senderId, result.reply, metaOptions);

  if (!messageResult.ok) {
    failures.push(`text: ${describeMetaResult(messageResult)}`);
  }

  if (result.carouselProducts && result.carouselProducts.length > 0) {
    const carouselResult = await sendMessengerCarousel(senderId, result.carouselProducts, metaOptions);

    if (!carouselResult.ok) {
      failures.push(`carousel: ${describeMetaResult(carouselResult)}`);
    }
  } else if (result.imagePaths?.length) {
    for (const imagePath of result.imagePaths) {
      const imageResult = await sendMessengerImage(senderId, imagePath, metaOptions);

      if (!imageResult.ok) {
        failures.push(`image ${imagePath}: ${describeMetaResult(imageResult)}`);
      }
    }
  } else if (result.imagePath) {
    const imageResult = await sendMessengerImage(senderId, result.imagePath, metaOptions);

    if (!imageResult.ok) {
      failures.push(`image ${result.imagePath}: ${describeMetaResult(imageResult)}`);
    }
  }

  if (failures.length > 0) {
    stats.deliveryFailures += failures.length;
    throw new Error(`Messenger delivery failed (${failures.join('; ')})`);
  }
}

async function escalateRepeatedFailure(params: {
  normalized: NormalizedMessage;
  brand?: string;
  error: unknown;
  stats: WebhookStats;
  pageAccessToken?: string;
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
      const delivery = await sendMessengerMessage(params.normalized.senderId, fallbackReply, {
        pageAccessToken: params.pageAccessToken,
      });

      if (!delivery.ok) {
        params.stats.deliveryFailures += 1;
        logWarn('Meta Webhook', 'Could not send Messenger processing-failure fallback.', {
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
      }),
      { pageAccessToken: params.pageAccessToken }
    );

    if (!delivery.ok) {
      params.stats.deliveryFailures += 1;
      logWarn('Meta Webhook', 'Could not send Messenger support-escalation fallback.', {
        senderId: params.normalized.senderId,
        eventId: params.normalized.eventId,
        error: describeMetaResult(delivery),
      });
    }
  }
}

async function processMessengerEvent(params: {
  webhookEvent: Record<string, unknown>;
  pageId: string;
  brand: string | null;
  pageAccessToken?: string;
  stats: WebhookStats;
}) {
  params.stats.received += 1;
  logDebug(
    'Meta Webhook',
    `Page ${params.brand || 'unknown'} received a raw messaging event.`,
    summarizeMessagingEvent(params.webhookEvent, params.pageId)
  );

  const normalized = normalizeMessengerEvent(params.webhookEvent, params.pageId);

  if (!normalized) {
    params.stats.skipped += 1;
    logDebug(
      'Meta Webhook',
      `Skipped Messenger event for page ${params.brand || 'unknown'} because it did not normalize.`,
      summarizeMessagingEvent(params.webhookEvent, params.pageId)
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
    logInfo('Meta Webhook', 'Skipped duplicate Messenger event.', {
      senderId: normalized.senderId,
      eventId: normalized.eventId,
    });
    return;
  }

  try {
    logInfo('Meta Webhook', 'Processing Messenger event.', {
      senderId: normalized.senderId,
      eventId: normalized.eventId,
      brand: params.brand || 'unknown',
      hasImage: Boolean(normalized.imageUrl),
      isPostback: normalized.isPostback,
    });

    const profile = IS_CHAT_TEST_MODE ? null : await getUserProfile(normalized.senderId, {
      pageAccessToken: params.pageAccessToken,
    });
    const customerName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : undefined;
    const customerGender = profile?.gender;

    const result = await routeCustomerMessage({
      senderId: normalized.senderId,
      channel: normalized.channel,
      currentMessage: normalized.messageText,
      brand: params.brand || undefined,
      customerName,
      customerGender,
      imageUrl: normalized.imageUrl,
    });

    await deliverCustomerResult(normalized.senderId, result, params.stats, params.pageAccessToken);
    await markWebhookEventProcessed(normalized.eventId);
    params.stats.processed += 1;
  } catch (error: unknown) {
    params.stats.failed += 1;
    logError('Meta Webhook', 'Messenger event processing failed.', {
      senderId: normalized.senderId,
      eventId: normalized.eventId,
      error: getErrorMessage(error),
    });
    await markWebhookEventFailed(normalized.eventId, error).catch((logErrorValue) => {
      logError('Meta Webhook', 'Could not mark Messenger event failed.', logErrorValue);
    });
    await escalateRepeatedFailure({
      normalized,
      brand: params.brand || undefined,
      error,
      stats: params.stats,
      pageAccessToken: params.pageAccessToken,
    }).catch((escalationError) => {
      logError('Meta Webhook', 'Could not escalate repeated Messenger failure.', escalationError);
    });
  }
}

async function processFacebookCommentChange(params: {
  changeValue: FacebookCommentChangeInput;
  pageId: string;
  brand: string | null;
  pageAccessToken?: string;
  stats: WebhookStats;
}) {
  params.stats.received += 1;
  const normalized = normalizeFacebookComment(params.changeValue, params.pageId);

  if (!normalized) {
    params.stats.skipped += 1;
    return;
  }

  params.stats.normalized += 1;
  const eventId = `facebook:${params.pageId}:comment:${normalized.commentId}`;
  const claim = await claimWebhookEvent({
    eventId,
    channel: 'facebook',
    eventType: 'comment',
    senderId: normalized.senderId,
    pageOrAccountId: normalized.pageOrAccountId,
    brand: params.brand,
  });

  if (claim.duplicate) {
    params.stats.duplicates += 1;
    logInfo('Meta Webhook', 'Skipped duplicate Facebook comment event.', {
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
      logDebug('Meta Webhook', `Already processed comment ${normalized.commentId}. Skipping.`);
      return;
    }

    logInfo('Meta Webhook', 'Processing Facebook comment.', {
      commentId: normalized.commentId,
      brand: params.brand || 'unknown',
      messagePreview: truncateForLog(normalized.message),
    });

    const replyText = await getAiCommentReply(normalized.message, params.brand || undefined);
    const publicResult = IS_CHAT_TEST_MODE
      ? ({ ok: true } satisfies MetaSendResult)
      : await sendFacebookCommentReply(normalized.commentId, replyText, {
        pageAccessToken: params.pageAccessToken,
      });
    const privateResult = IS_CHAT_TEST_MODE
      ? ({ ok: true } satisfies MetaSendResult)
      : await sendFacebookPrivateReply(normalized.commentId, replyText, {
        pageAccessToken: params.pageAccessToken,
      });

    if (publicResult.ok) {
      await prisma.commentLog.create({
        data: {
          id: normalized.commentId,
          channel: 'facebook',
          brand: params.brand || null,
        },
      });
    }

    if (!publicResult.ok) {
      params.stats.deliveryFailures += 1;
      throw new Error(
        `Facebook public comment delivery failed: ${describeMetaResult(publicResult)}`
      );
    }

    if (!privateResult.ok) {
      params.stats.deliveryFailures += 1;
      logWarn('Meta Webhook', 'Facebook private comment reply failed after public reply succeeded.', {
        commentId: normalized.commentId,
        error: describeMetaResult(privateResult),
      });
    }

    await markWebhookEventProcessed(eventId);
    params.stats.processed += 1;
  } catch (error: unknown) {
    params.stats.failed += 1;
    logError('Meta Webhook', 'Facebook comment processing failed.', {
      eventId,
      commentId: normalized.commentId,
      error: getErrorMessage(error),
    });
    await markWebhookEventFailed(eventId, error).catch((logErrorValue) => {
      logError('Meta Webhook', 'Could not mark Facebook comment failed.', logErrorValue);
    });
  }
}

export async function GET(request: Request) {
  logRuntimeWarnings('Meta Webhook');
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  if (!VERIFY_TOKEN) {
    logError('Meta Webhook', 'Verification failed because META_VERIFY_TOKEN is not configured.');
    return new NextResponse('Webhook verify token is not configured.', { status: 500 });
  }

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logInfo('Meta Webhook', 'Verification successful.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      logError('Meta Webhook', 'Verification failed.');
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  return new NextResponse('Bad Request', { status: 400 });
}

export async function POST(request: Request) {
  logRuntimeWarnings('Meta Webhook');
  const stats = createStats();
  const startedAt = Date.now();

  let body: unknown;

  try {
    body = await request.json();
  } catch (error: unknown) {
    logError('Meta Webhook', 'Invalid webhook JSON payload.', error);
    return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (!isRecord(body) || body.object !== 'page') {
    return NextResponse.json({ success: false }, { status: 404 });
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];

  logInfo('Meta Webhook', 'Received Messenger webhook batch.', {
    object: body.object,
    entryCount: entries.length,
  });

  for (const entry of entries) {
    if (!isRecord(entry)) {
      stats.skipped += 1;
      continue;
    }

    const pageId = typeof entry.id === 'string' ? entry.id : '';
    const pageConfig = pageId ? await resolveFacebookConfigForPageId(pageId) : null;
    const brand = pageConfig?.brand ?? (pageId ? await resolveBrandForFacebookPageId(pageId) : null);
    const pageAccessToken = pageConfig?.pageAccessToken;
    const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const webhookEvent of messagingEvents) {
      if (!isRecord(webhookEvent)) {
        stats.skipped += 1;
        continue;
      }

      await processMessengerEvent({
        webhookEvent,
        pageId,
        brand,
        pageAccessToken,
        stats,
      }).catch((error: unknown) => {
        stats.failed += 1;
        logError('Meta Webhook', 'Messenger event failed before processing could start.', {
          pageId,
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

      await processFacebookCommentChange({
        changeValue: change.value as unknown as FacebookCommentChangeInput,
        pageId,
        brand,
        pageAccessToken,
        stats,
      }).catch((error: unknown) => {
        stats.failed += 1;
        logError('Meta Webhook', 'Facebook comment failed before processing could start.', {
          pageId,
          brand: brand || 'unknown',
          error: getErrorMessage(error),
        });
      });
    }
  }

  logInfo('Meta Webhook', 'Completed Messenger webhook batch.', {
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
