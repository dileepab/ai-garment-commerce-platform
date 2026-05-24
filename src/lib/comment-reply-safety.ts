import prisma from '@/lib/prisma';
import { getAiCommentReply } from '@/lib/ai';
import { logError, logInfo, logWarn } from '@/lib/app-log';
import { getErrorMessage } from '@/lib/error-message';
import { sendFacebookCommentReply } from '@/lib/meta-comments';
import { resolveFacebookConfigForPageId } from '@/lib/brand-channel-config';
import type { NormalizedComment } from '@/lib/meta-normalize';

const COMMENT_REPLY_CHANNEL = 'facebook';
const BUSINESS_TIME_ZONE = 'Asia/Colombo';
const MAX_COMMENT_AGE_DAYS = 7;
const USER_POST_COOLDOWN_HOURS = 24;
const DEFAULT_MAX_REPLIES_PER_PAGE_HOUR = 60;
const DEFAULT_DELAY_MIN_SECONDS = 30;
const DEFAULT_DELAY_MAX_SECONDS = 120;
const MAX_SEND_ATTEMPTS = 3;

const TRIGGER_KEYWORDS = [
  'price',
  'how much',
  'available',
  'availability',
  'size',
  'delivery',
  'cod',
  'order',
  'ගාන',
  'කීය',
  'මිල',
  'තියෙන',
  'තිබේ',
  'සයිස්',
  'ඩිලිවරි',
  'ඕඩර්',
  'விலை',
  'எவ்வளவு',
  'இருக்கா',
  'உள்ளதா',
  'அளவு',
  'டெலிவரி',
  'ஆர்டர்',
];

const OPT_OUT_KEYWORDS = [
  'stop',
  'unsubscribe',
  'do not reply',
  'dont reply',
  'don’t reply',
  'remove me',
  'එපා',
  'නවත්වන්න',
  'வேண்டாம்',
  'நிறுத்து',
];

export interface CommentSafetyDecision {
  shouldQueue: boolean;
  reason?: string;
  scheduledAt?: Date;
}

export interface CommentReplyQueueResult {
  queued: boolean;
  skipped: boolean;
  reason?: string;
}

export interface CommentReplyProcessingResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  rescheduled: number;
}

function envNumber(key: string, fallback: number): number {
  const value = Number.parseInt(process.env[key] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function lower(value: string): string {
  return value.toLocaleLowerCase('en-US');
}

function hasLetterOrNumber(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function isNoisyComment(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (!hasLetterOrNumber(trimmed)) return true;
  return trimmed.length < 2;
}

function containsAny(message: string, keywords: string[]): boolean {
  const normalized = lower(message);
  return keywords.some((keyword) => normalized.includes(lower(keyword)));
}

function isBusinessHours(now = new Date()): boolean {
  const hourText = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hour = Number.parseInt(hourText, 10);

  return hour >= 9 && hour < 21;
}

function getSriLankaDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '0';

  return {
    year: Number.parseInt(value('year'), 10),
    month: Number.parseInt(value('month'), 10),
    day: Number.parseInt(value('day'), 10),
    hour: Number.parseInt(value('hour'), 10),
  };
}

function sriLankaWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const sriLankaOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0) - sriLankaOffsetMs);
}

function nextBusinessOpening(now = new Date()): Date {
  const parts = getSriLankaDateParts(now);
  const openingToday = sriLankaWallClockToUtc(parts.year, parts.month, parts.day, 9, 0);

  if (parts.hour < 9) {
    return openingToday;
  }

  const nextDay = new Date(openingToday.getTime() + 24 * 60 * 60 * 1000);
  return nextDay;
}

function commentIsTooOld(createdTime?: string): boolean {
  if (!createdTime) return false;

  const createdAt = new Date(createdTime);
  if (Number.isNaN(createdAt.getTime())) return false;

  return createdAt.getTime() < Date.now() - MAX_COMMENT_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function randomReplyDelayMs(): number {
  const min = envNumber('COMMENT_REPLY_DELAY_MIN_SECONDS', DEFAULT_DELAY_MIN_SECONDS);
  const max = Math.max(min, envNumber('COMMENT_REPLY_DELAY_MAX_SECONDS', DEFAULT_DELAY_MAX_SECONDS));
  const seconds = min + Math.floor(Math.random() * (max - min + 1));
  return seconds * 1000;
}

async function recordCommentStatus(
  comment: NormalizedComment,
  status: string,
  params: {
    brand?: string | null;
    reason?: string | null;
    replyText?: string | null;
  } = {},
) {
  await prisma.commentLog.upsert({
    where: { id: comment.commentId },
    create: {
      id: comment.commentId,
      channel: COMMENT_REPLY_CHANNEL,
      brand: params.brand || null,
      senderId: comment.senderId || null,
      pageOrAccountId: comment.pageOrAccountId || null,
      postId: comment.postId || null,
      message: comment.message || null,
      replyText: params.replyText || null,
      status,
      skipReason: params.reason || null,
    },
    update: {
      brand: params.brand || null,
      senderId: comment.senderId || null,
      pageOrAccountId: comment.pageOrAccountId || null,
      postId: comment.postId || null,
      message: comment.message || null,
      replyText: params.replyText || undefined,
      status,
      skipReason: params.reason || null,
      repliedAt: new Date(),
    },
  });
}

async function isOptedOut(comment: NormalizedComment): Promise<boolean> {
  if (!comment.senderId || !comment.pageOrAccountId) return false;

  const existing = await prisma.commentOptOut.findUnique({
    where: {
      channel_senderId_pageOrAccountId: {
        channel: COMMENT_REPLY_CHANNEL,
        senderId: comment.senderId,
        pageOrAccountId: comment.pageOrAccountId,
      },
    },
    select: { id: true },
  });

  return Boolean(existing);
}

async function optOutCommenter(comment: NormalizedComment, brand?: string | null) {
  if (!comment.senderId || !comment.pageOrAccountId) return;

  await prisma.commentOptOut.upsert({
    where: {
      channel_senderId_pageOrAccountId: {
        channel: COMMENT_REPLY_CHANNEL,
        senderId: comment.senderId,
        pageOrAccountId: comment.pageOrAccountId,
      },
    },
    create: {
      channel: COMMENT_REPLY_CHANNEL,
      senderId: comment.senderId,
      pageOrAccountId: comment.pageOrAccountId,
      brand: brand || null,
      reason: 'comment_opt_out_keyword',
    },
    update: {
      brand: brand || null,
      reason: 'comment_opt_out_keyword',
    },
  });
}

async function hasRecentReplyForUserPost(comment: NormalizedComment): Promise<boolean> {
  if (!comment.senderId) return false;

  const since = new Date(Date.now() - USER_POST_COOLDOWN_HOURS * 60 * 60 * 1000);
  const existing = await prisma.commentLog.findFirst({
    where: {
      channel: COMMENT_REPLY_CHANNEL,
      senderId: comment.senderId,
      status: { in: ['queued', 'replied'] },
      repliedAt: { gte: since },
      ...(comment.postId
        ? { postId: comment.postId }
        : { pageOrAccountId: comment.pageOrAccountId }),
    },
    select: { id: true },
  });

  return Boolean(existing);
}

async function pageHourlyLimitReached(pageOrAccountId: string): Promise<boolean> {
  const maxPerHour = envNumber('COMMENT_REPLY_MAX_PER_PAGE_HOUR', DEFAULT_MAX_REPLIES_PER_PAGE_HOUR);
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recentReplies = await prisma.commentLog.count({
    where: {
      channel: COMMENT_REPLY_CHANNEL,
      pageOrAccountId,
      status: 'replied',
      repliedAt: { gte: since },
    },
  });

  return recentReplies >= maxPerHour;
}

export async function evaluateCommentSafety(
  comment: NormalizedComment,
  brand?: string | null,
): Promise<CommentSafetyDecision> {
  if (!comment.senderId) return { shouldQueue: false, reason: 'missing_sender' };
  if (comment.hideComment) return { shouldQueue: false, reason: 'hidden_comment' };
  if (commentIsTooOld(comment.createdTime)) return { shouldQueue: false, reason: 'stale_comment' };

  if (containsAny(comment.message, OPT_OUT_KEYWORDS)) {
    await optOutCommenter(comment, brand);
    return { shouldQueue: false, reason: 'commenter_opted_out' };
  }

  if (await isOptedOut(comment)) return { shouldQueue: false, reason: 'commenter_blocklisted' };
  if (isNoisyComment(comment.message)) return { shouldQueue: false, reason: 'noisy_comment' };
  if (!containsAny(comment.message, TRIGGER_KEYWORDS)) return { shouldQueue: false, reason: 'no_trigger_keyword' };
  if (await hasRecentReplyForUserPost(comment)) return { shouldQueue: false, reason: 'user_post_cooldown' };
  if (await pageHourlyLimitReached(comment.pageOrAccountId)) return { shouldQueue: false, reason: 'page_hourly_limit' };

  if (!isBusinessHours()) {
    return {
      shouldQueue: true,
      reason: 'queued_for_next_business_hours',
      scheduledAt: nextBusinessOpening(),
    };
  }

  return { shouldQueue: true };
}

export async function queueFacebookCommentReply(
  comment: NormalizedComment,
  brand?: string | null,
): Promise<CommentReplyQueueResult> {
  const decision = await evaluateCommentSafety(comment, brand);

  if (!decision.shouldQueue) {
    await recordCommentStatus(comment, 'skipped', { brand, reason: decision.reason });
    return { queued: false, skipped: true, reason: decision.reason };
  }

  const scheduledAt = decision.scheduledAt ?? new Date(Date.now() + randomReplyDelayMs());

  await prisma.commentReplyQueue.upsert({
    where: { commentId: comment.commentId },
    create: {
      commentId: comment.commentId,
      channel: COMMENT_REPLY_CHANNEL,
      pageOrAccountId: comment.pageOrAccountId,
      senderId: comment.senderId,
      postId: comment.postId || null,
      brand: brand || null,
      message: comment.message,
      status: 'pending',
      scheduledAt,
    },
    update: {
      brand: brand || null,
      message: comment.message,
      status: 'pending',
      scheduledAt,
    },
  });

  await recordCommentStatus(comment, 'queued', { brand });

  return { queued: true, skipped: false, reason: decision.reason };
}

export async function processDueFacebookCommentReplies(now = new Date(), limit = 10): Promise<CommentReplyProcessingResult> {
  const result: CommentReplyProcessingResult = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    rescheduled: 0,
  };
  const dueItems = await prisma.commentReplyQueue.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: now },
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });

  for (const item of dueItems) {
    result.checked += 1;
    const claim = await prisma.commentReplyQueue.updateMany({
      where: { id: item.id, status: 'pending' },
      data: { status: 'processing', attempts: { increment: 1 }, lastError: null },
    });

    if (claim.count === 0) {
      result.skipped += 1;
      continue;
    }

    const attempts = item.attempts + 1;

    try {
      if (await pageHourlyLimitReached(item.pageOrAccountId)) {
        await prisma.commentReplyQueue.update({
          where: { id: item.id },
          data: {
            status: 'pending',
            scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
            lastError: 'Rescheduled because page hourly reply limit was reached.',
          },
        });
        result.rescheduled += 1;
        continue;
      }

      const pageConfig = await resolveFacebookConfigForPageId(item.pageOrAccountId);
      if (!pageConfig?.pageAccessToken) {
        throw new Error(`Missing Facebook Page token for page ${item.pageOrAccountId}.`);
      }

      const replyText = item.replyText || await getAiCommentReply(item.message, item.brand || pageConfig.brand);
      const sendResult = await sendFacebookCommentReply(item.commentId, replyText, {
        pageAccessToken: pageConfig.pageAccessToken,
      });

      if (!sendResult.ok) {
        throw new Error(sendResult.error || 'Facebook comment reply failed.');
      }

      await prisma.commentReplyQueue.update({
        where: { id: item.id },
        data: {
          status: 'sent',
          replyText,
          sentAt: new Date(),
        },
      });
      await prisma.commentLog.update({
        where: { id: item.commentId },
        data: {
          brand: item.brand || pageConfig.brand,
          replyText,
          status: 'replied',
          skipReason: null,
          repliedAt: new Date(),
        },
      });
      result.sent += 1;
      logInfo('Comment Reply Safety', 'Sent queued Facebook comment reply.', {
        commentId: item.commentId,
        brand: item.brand || pageConfig.brand,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error).slice(0, 1000);
      const failedPermanently = attempts >= MAX_SEND_ATTEMPTS;

      await prisma.commentReplyQueue.update({
        where: { id: item.id },
        data: {
          status: failedPermanently ? 'failed' : 'pending',
          scheduledAt: failedPermanently ? item.scheduledAt : new Date(Date.now() + attempts * 5 * 60 * 1000),
          lastError: errorMessage,
        },
      });
      await prisma.commentLog.update({
        where: { id: item.commentId },
        data: {
          status: failedPermanently ? 'failed' : 'queued',
          skipReason: errorMessage,
          repliedAt: new Date(),
        },
      }).catch((logErrorValue) => {
        logError('Comment Reply Safety', 'Could not update comment log after send failure.', logErrorValue);
      });

      if (failedPermanently) {
        result.failed += 1;
        logError('Comment Reply Safety', 'Queued Facebook comment reply failed permanently.', {
          commentId: item.commentId,
          error: errorMessage,
        });
      } else {
        result.rescheduled += 1;
        logWarn('Comment Reply Safety', 'Queued Facebook comment reply failed; retry scheduled.', {
          commentId: item.commentId,
          attempts,
          error: errorMessage,
        });
      }
    }
  }

  return result;
}
