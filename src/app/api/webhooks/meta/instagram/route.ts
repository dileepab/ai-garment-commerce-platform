import { NextResponse } from 'next/server';
import {
  sendInstagramMessage,
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
import {
  getConfiguredInstagramAccountIds,
  resolveBrandForInstagramAccountId,
  resolveInstagramConfigForAccountId,
} from '@/lib/brand-channel-config';
import {
  getInstagramBusinessLoopSkipReason,
  getInstagramInternalSenderIdsForBrand,
  getWebhookMessageTextForLoopGuard,
  getWebhookSenderId,
} from '@/lib/meta-loop-guard';
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
import { isMetaCommentAutoReplyEnabled } from '@/lib/meta-feature-flags';
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
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];

  return {
    senderId,
    senderMatchesAccount: senderId === accountId,
    hasMessage: Boolean(message),
    hasPostback: Boolean(postback),
    hasRead: typeof webhookEvent.read === 'object' && webhookEvent.read !== null,
    hasDelivery: typeof webhookEvent.delivery === 'object' && webhookEvent.delivery !== null,
    messageText,
    isEcho: message?.is_echo === true,
    attachmentCount: attachments.length,
    messageKeys: message ? Object.keys(message) : [],
    postbackKeys: postback ? Object.keys(postback) : [],
    keys: Object.keys(webhookEvent),
  };
}

function getInstagramEventSkipReason(webhookEvent: Record<string, unknown>, accountId: string): string {
  const summary = summarizeMessagingEvent(webhookEvent, accountId);

  if (summary.isEcho) return 'echo_message';
  if (!summary.senderId) return 'missing_sender';
  if (summary.senderMatchesAccount) return 'sender_is_business_account';
  if (summary.hasRead) return 'read_receipt';
  if (summary.hasDelivery) return 'delivery_receipt';
  if (!summary.hasMessage && !summary.hasPostback) return 'missing_message_or_postback';
  if (summary.hasMessage && !summary.messageText && summary.attachmentCount === 0) return 'empty_message';
  if (summary.hasPostback && summary.postbackKeys.length === 0) return 'empty_postback';

  return 'unsupported_event_shape';
}

async function deliverCustomerResult(
  senderId: string,
  result: CustomerMessageResult,
  stats: WebhookStats,
  accountId: string,
  pageAccessToken?: string
) {
  if (IS_CHAT_TEST_MODE || !result.reply) {
    return;
  }

  const failures: string[] = [];
  const metaOptions = { pageAccessToken, language: result.language, quickReplies: result.quickReplies };
  const messageResult = await sendInstagramMessage(senderId, accountId, result.reply, metaOptions);

  if (!messageResult.ok) {
    failures.push(`text: ${describeMetaResult(messageResult)}`);
  }

  if (result.carouselProducts?.length || result.imagePaths?.length || result.imagePath) {
    logWarn('Instagram Webhook', 'Skipped Instagram rich media delivery; text reply was attempted.', {
      senderId,
      hasCarousel: Boolean(result.carouselProducts?.length),
      imageCount: result.imagePaths?.length || (result.imagePath ? 1 : 0),
    });
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
  accountId: string;
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
      const delivery = await sendInstagramMessage(
        params.normalized.senderId,
        params.accountId,
        fallbackReply,
        { pageAccessToken: params.pageAccessToken },
      );

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
    const delivery = await sendInstagramMessage(
      params.normalized.senderId,
      params.accountId,
      buildHumanSupportReply({
        reason: 'unclear_request',
        supportConfig: settings.support,
      }),
      { pageAccessToken: params.pageAccessToken }
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
  pageAccessToken?: string;
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
    logInfo('Instagram Webhook', 'Skipped Instagram event because it did not normalize.', {
      accountId: params.accountId,
      brand: params.brand || 'unknown',
      reason: getInstagramEventSkipReason(params.webhookEvent, params.accountId),
      summary: summarizeMessagingEvent(params.webhookEvent, params.accountId),
    });
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

    await deliverCustomerResult(normalized.senderId, result, params.stats, params.accountId, params.pageAccessToken);
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
      accountId: params.accountId,
      pageAccessToken: params.pageAccessToken,
    }).catch((escalationError) => {
      logError('Instagram Webhook', 'Could not escalate repeated Instagram failure.', escalationError);
    });
  }
}

async function processInstagramCommentChange(params: {
  changeValue: InstagramCommentChangeInput;
  accountId: string;
  brand: string | null;
  pageAccessToken?: string;
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

    if (!await isMetaCommentAutoReplyEnabled(params.brand)) {
      await prisma.commentLog.upsert({
        where: { id: normalized.commentId },
        create: {
          id: normalized.commentId,
          channel: 'instagram',
          brand: params.brand || null,
          senderId: normalized.senderId || null,
          pageOrAccountId: normalized.pageOrAccountId || null,
          postId: normalized.postId || null,
          message: normalized.message || null,
          status: 'skipped',
          skipReason: 'feature_disabled',
        },
        update: {
          brand: params.brand || null,
          senderId: normalized.senderId || null,
          pageOrAccountId: normalized.pageOrAccountId || null,
          postId: normalized.postId || null,
          message: normalized.message || null,
          status: 'skipped',
          skipReason: 'feature_disabled',
          repliedAt: new Date(),
        },
      });
      params.stats.skipped += 1;
      await markWebhookEventProcessed(eventId, 'skipped');
      logInfo('Instagram Webhook', 'Skipped Instagram comment auto-reply because it is disabled in Merchant Settings.', {
        commentId: normalized.commentId,
        brand: params.brand || 'unknown',
      });
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
      : await sendInstagramCommentReply(normalized.commentId, replyText, {
        pageAccessToken: params.pageAccessToken,
      });
    const privateResult = IS_CHAT_TEST_MODE
      ? ({ ok: true } satisfies MetaSendResult)
      : await sendInstagramPrivateReply(normalized.commentId, params.accountId, replyText, {
        pageAccessToken: params.pageAccessToken,
      });

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
  const configuredInstagramAccountIds = await getConfiguredInstagramAccountIds();

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
    const accountConfig = accountId ? await resolveInstagramConfigForAccountId(accountId) : null;
    const brand = accountConfig?.brand ?? (accountId ? await resolveBrandForInstagramAccountId(accountId) : null);
    const pageAccessToken = accountConfig?.accessToken;
    const internalSenderIds = getInstagramInternalSenderIdsForBrand(brand);
    const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    logInfo('Instagram Webhook', 'Inspecting Instagram webhook entry.', {
      accountId: accountId || null,
      brand: brand || 'unknown',
      hasConfiguredToken: Boolean(pageAccessToken),
      messagingEventCount: messagingEvents.length,
      changeCount: changes.length,
      entryKeys: Object.keys(entry),
    });

    for (const webhookEvent of messagingEvents) {
      if (!isRecord(webhookEvent)) {
        stats.skipped += 1;
        continue;
      }

      const senderId = getWebhookSenderId(webhookEvent);
      const loopSkipReason = getInstagramBusinessLoopSkipReason({
        senderId,
        messageText: getWebhookMessageTextForLoopGuard(webhookEvent),
        configuredAccountIds: configuredInstagramAccountIds,
        internalSenderIds,
      });

      if (loopSkipReason) {
        stats.skipped += 1;
        logInfo('Instagram Webhook', 'Skipped Instagram event to prevent managed account reply loop.', {
          accountId,
          brand: brand || 'unknown',
          reason: loopSkipReason,
          senderId,
          senderBrand: senderId ? await resolveBrandForInstagramAccountId(senderId) || 'unknown' : 'unknown',
          summary: summarizeMessagingEvent(webhookEvent, accountId),
        });
        continue;
      }

      await processInstagramEvent({
        webhookEvent,
        accountId,
        brand,
        pageAccessToken,
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
        pageAccessToken,
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
