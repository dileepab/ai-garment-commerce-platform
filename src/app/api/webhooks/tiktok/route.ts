import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import { upsertSupportEscalation } from '@/lib/customer-support';
import { getErrorMessage } from '@/lib/error-message';
import { logError, logInfo, logWarn } from '@/lib/app-log';
import {
  getTikTokAccountConfigStatus,
  getTikTokAccountRuntimeConfig,
} from '@/lib/tiktok-account-config';
import {
  hasTikTokDmPermissions,
  parseTikTokAccountScopes,
  resolveTikTokAccountConnectionByOpenId,
} from '@/lib/tiktok-account-connection';
import { sendTikTokDirectMessage } from '@/lib/tiktok-account-api';
import {
  extractTikTokWebhook,
  type NormalizedTikTokCommentEvent,
  type NormalizedTikTokDirectMessageEvent,
} from '@/lib/tiktok-normalize';
import { verifyTikTokWebhookSignature } from '@/lib/tiktok-webhook-signature';
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '@/lib/webhook-event-log';
import type { CustomerMessageResult } from '@/lib/chat/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WebhookStats {
  received: number;
  processed: number;
  skipped: number;
  duplicates: number;
  failed: number;
}

function createStats(): WebhookStats {
  return { received: 0, processed: 0, skipped: 0, duplicates: 0, failed: 0 };
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

async function saveInboxContext(params: {
  brand: string;
  channel: 'tiktok_dm' | 'tiktok_comment';
  senderId: string;
  businessOpenId: string;
  conversationId?: string | null;
  videoId?: string | null;
  commentId?: string | null;
  customerOpenId?: string | null;
  customerName?: string | null;
  occurredAt: Date;
}) {
  const identity = {
    brand: params.brand,
    channel: params.channel,
    senderId: params.senderId,
  };
  const context = {
    businessOpenId: params.businessOpenId,
    conversationId: params.conversationId || null,
    videoId: params.videoId || null,
    commentId: params.commentId || null,
    customerOpenId: params.customerOpenId || null,
    customerName: params.customerName || null,
    lastInboundAt: params.occurredAt,
  };
  const updated = await prisma.tikTokInboxContext.updateMany({
    where: {
      ...identity,
      lastInboundAt: { lte: params.occurredAt },
    },
    data: context,
  });
  if (updated.count > 0) return;

  try {
    await prisma.tikTokInboxContext.create({
      data: { ...identity, ...context },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    // Another webhook may have created the same thread concurrently. Only let
    // this event replace its delivery context when it is at least as recent.
    await prisma.tikTokInboxContext.updateMany({
      where: {
        ...identity,
        lastInboundAt: { lte: params.occurredAt },
      },
      data: context,
    });
  }
}

async function saveManualInboxMessage(params: {
  brand: string;
  channel: 'tiktok_dm' | 'tiktok_comment';
  senderId: string;
  message: string;
  externalMessageId: string;
  contactName?: string | null;
  occurredAt: Date;
  reason: string;
}) {
  await upsertSupportEscalation({
    senderId: params.senderId,
    channel: params.channel,
    brand: params.brand,
    contactName: params.contactName || null,
    latestCustomerMessage: params.message,
    reason: 'unclear_request',
    summary: [
      params.reason,
      `Latest customer message: ${params.message}`,
      'Reply from the GarmentOS Support Inbox.',
    ].join('\n'),
  });
  await prisma.chatMessage.upsert({
    where: {
      channel_externalMessageId: {
        channel: params.channel,
        externalMessageId: params.externalMessageId,
      },
    },
    create: {
      senderId: params.senderId,
      channel: params.channel,
      brand: params.brand,
      role: 'user',
      message: params.message,
      externalMessageId: params.externalMessageId,
      createdAt: params.occurredAt,
    },
    update: {},
  });
}

async function deliverDirectMessageResult(
  event: NormalizedTikTokDirectMessageEvent,
  result: CustomerMessageResult,
) {
  const connection = await resolveTikTokAccountConnectionByOpenId(event.businessOpenId);
  if (!connection) throw new Error('TikTok Business Account connection is missing.');
  if (!connection.grantedScopes.includes('message.list.send')) {
    throw new Error('TikTok Business Messaging Send permission is missing.');
  }

  const messages = [
    result.reply,
    result.carouselProducts?.length ? buildCatalogText(result.carouselProducts) : null,
  ].filter((message): message is string => Boolean(message?.trim()));

  for (const message of messages) {
    const delivery = await sendTikTokDirectMessage({
      accessToken: connection.accessToken,
      businessId: connection.openId,
      conversationId: event.conversationId,
      text: message,
    });
    if (!delivery.ok) throw new Error(delivery.error || 'TikTok direct message delivery failed.');
  }
}

async function processDirectMessage(
  event: NormalizedTikTokDirectMessageEvent,
  brand: string,
  dmAutomationEnabledForBrand: boolean,
  stats: WebhookStats,
) {
  const canUseChatbot = dmAutomationEnabledForBrand && event.automatable;
  const claim = await claimWebhookEvent({
    eventId: event.eventId,
    channel: 'tiktok_dm',
    eventType: 'message',
    senderId: event.conversationId,
    pageOrAccountId: event.businessOpenId,
    brand,
    retryFailed: !canUseChatbot,
  });
  if (!claim.claimed) {
    stats.duplicates += 1;
    return;
  }

  try {
    await saveInboxContext({
      brand,
      channel: 'tiktok_dm',
      senderId: event.conversationId,
      businessOpenId: event.businessOpenId,
      conversationId: event.conversationId,
      customerOpenId: event.customerOpenId,
      customerName: event.customerName,
      occurredAt: event.occurredAt,
    });

    if (!canUseChatbot) {
      await saveManualInboxMessage({
        brand,
        channel: 'tiktok_dm',
        senderId: event.conversationId,
        message: event.text,
        externalMessageId: event.eventId,
        contactName: event.customerName,
        occurredAt: event.occurredAt,
        reason: event.automatable
          ? 'TikTok DM received while automatic replies are approval-gated.'
          : 'TikTok media/share message requires a human reply.',
      });
    } else {
      const result = await routeCustomerMessage({
        senderId: event.conversationId,
        channel: 'tiktok_dm',
        currentMessage: event.text,
        brand,
        customerName: event.customerName || undefined,
      });
      await deliverDirectMessageResult(event, result);
    }
    await markWebhookEventProcessed(event.eventId);
    stats.processed += 1;
  } catch (error) {
    await markWebhookEventFailed(event.eventId, error).catch(() => undefined);
    await upsertSupportEscalation({
      senderId: event.conversationId,
      channel: 'tiktok_dm',
      brand,
      contactName: event.customerName,
      latestCustomerMessage: event.text,
      reason: 'unclear_request',
      summary: `TikTok DM automation failed: ${getErrorMessage(error)}\nLatest customer message: ${event.text}`,
    }).catch(() => undefined);
    stats.failed += 1;
    logError('TikTok Webhook', 'TikTok DM processing failed.', {
      eventId: event.eventId,
      brand,
      error: getErrorMessage(error),
    });
  }
}

async function processComment(
  event: NormalizedTikTokCommentEvent,
  brand: string,
  stats: WebhookStats,
) {
  const claim = await claimWebhookEvent({
    eventId: event.eventId,
    channel: 'tiktok_comment',
    eventType: 'comment',
    senderId: event.threadId,
    pageOrAccountId: event.businessOpenId,
    brand,
    retryFailed: true,
  });
  if (!claim.claimed) {
    stats.duplicates += 1;
    return;
  }

  try {
    await saveInboxContext({
      brand,
      channel: 'tiktok_comment',
      senderId: event.threadId,
      businessOpenId: event.businessOpenId,
      videoId: event.videoId,
      commentId: event.commentId,
      customerOpenId: event.customerOpenId,
      occurredAt: event.occurredAt,
    });
    await saveManualInboxMessage({
      brand,
      channel: 'tiktok_comment',
      senderId: event.threadId,
      message: event.text,
      externalMessageId: event.eventId,
      contactName: event.customerOpenId,
      occurredAt: event.occurredAt,
      reason: 'Public TikTok comment awaiting a privacy-safe human reply.',
    });
    await markWebhookEventProcessed(event.eventId);
    stats.processed += 1;
  } catch (error) {
    await markWebhookEventFailed(event.eventId, error).catch(() => undefined);
    stats.failed += 1;
    logError('TikTok Webhook', 'TikTok comment processing failed.', {
      eventId: event.eventId,
      brand,
      error: getErrorMessage(error),
    });
  }
}

export async function POST(request: Request) {
  const stats = createStats();
  const rawBody = await request.text();

  let config;
  try {
    config = getTikTokAccountRuntimeConfig();
  } catch {
    return NextResponse.json(
      { success: false, error: 'TikTok Account integration is not configured.' },
      { status: 503 },
    );
  }

  if (!verifyTikTokWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get('tiktok-signature'),
    appSecret: config.clientSecret,
  })) {
    logWarn('TikTok Webhook', 'Rejected webhook with an invalid TikTok signature.');
    return NextResponse.json({ success: false, error: 'Invalid signature.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const clientKey = typeof body === 'object' && body !== null
    ? (body as { client_key?: unknown }).client_key
    : null;
  if (clientKey !== config.clientId) {
    return NextResponse.json({ success: false, error: 'Unexpected TikTok app.' }, { status: 403 });
  }

  const extracted = extractTikTokWebhook(body);
  stats.received = extracted.comments.length + extracted.directMessages.length;
  stats.skipped += extracted.unsupportedEventCount;
  const businessOpenId = extracted.comments[0]?.businessOpenId
    ?? extracted.directMessages[0]?.businessOpenId
    ?? null;
  if (!businessOpenId) {
    return NextResponse.json({ success: true, stats });
  }

  const account = await prisma.tikTokAccountConnection.findUnique({
    where: { openId: businessOpenId },
    select: {
      brand: true,
      dmAutoReplyEnabled: true,
      grantedScopes: true,
      lastError: true,
    },
  });
  if (!account) {
    stats.skipped += stats.received;
    logWarn('TikTok Webhook', 'Skipped event for an unconfigured TikTok Business Account.', {
      businessOpenId,
    });
    return NextResponse.json({ success: true, stats });
  }

  for (const comment of extracted.comments) {
    await processComment(comment, account.brand, stats);
  }
  for (const message of extracted.directMessages) {
    const dmPermissionsReady = hasTikTokDmPermissions(
      parseTikTokAccountScopes(account.grantedScopes),
    );
    await processDirectMessage(
      message,
      account.brand,
      account.dmAutoReplyEnabled
        && !account.lastError
        && getTikTokAccountConfigStatus().dmAutoReplyEnabled
        && dmPermissionsReady,
      stats,
    );
  }

  logInfo('TikTok Webhook', 'Processed TikTok Account webhook.', {
    businessOpenId,
    brand: account.brand,
    ...stats,
  });
  return NextResponse.json(
    { success: stats.failed === 0, stats },
    { status: stats.failed > 0 ? 500 : 200 },
  );
}
