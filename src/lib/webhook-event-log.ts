import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { logDebug, logError } from '@/lib/app-log';

export type WebhookEventStatus = 'processing' | 'processed' | 'failed' | 'skipped';

export interface WebhookEventClaimInput {
  eventId?: string | null;
  channel: string;
  eventType: string;
  senderId?: string | null;
  pageOrAccountId?: string | null;
  brand?: string | null;
}

export interface WebhookEventClaimResult {
  claimed: boolean;
  duplicate: boolean;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function clampErrorMessage(error: unknown): string {
  return getErrorMessage(error).slice(0, 1000);
}

export async function claimWebhookEvent(
  input: WebhookEventClaimInput
): Promise<WebhookEventClaimResult> {
  if (!input.eventId) {
    return { claimed: true, duplicate: false };
  }

  try {
    await prisma.webhookEventLog.create({
      data: {
        id: input.eventId,
        channel: input.channel,
        eventType: input.eventType,
        senderId: input.senderId || null,
        pageOrAccountId: input.pageOrAccountId || null,
        brand: input.brand || null,
        status: 'processing',
      },
    });

    return { claimed: true, duplicate: false };
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      logDebug('Webhook Event Log', `Duplicate event ${input.eventId} skipped.`);
      return { claimed: false, duplicate: true };
    }

    logError('Webhook Event Log', `Could not claim event ${input.eventId}.`, error);
    throw error;
  }
}

export async function markWebhookEventProcessed(
  eventId?: string | null,
  status: WebhookEventStatus = 'processed'
) {
  if (!eventId) {
    return;
  }

  await prisma.webhookEventLog.update({
    where: {
      id: eventId,
    },
    data: {
      status,
      processedAt: new Date(),
      error: null,
    },
  });
}

export async function markWebhookEventFailed(
  eventId: string | null | undefined,
  error: unknown
) {
  if (!eventId) {
    return;
  }

  await prisma.webhookEventLog.update({
    where: {
      id: eventId,
    },
    data: {
      status: 'failed',
      processedAt: new Date(),
      error: clampErrorMessage(error),
    },
  });
}

export async function countRecentWebhookFailures(params: {
  channel: string;
  senderId: string;
  withinMs: number;
}) {
  return prisma.webhookEventLog.count({
    where: {
      channel: params.channel,
      senderId: params.senderId,
      status: 'failed',
      updatedAt: {
        gte: new Date(Date.now() - params.withinMs),
      },
    },
  });
}
