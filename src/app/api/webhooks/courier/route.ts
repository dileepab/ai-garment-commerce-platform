import { NextResponse } from 'next/server';
import {
  mapCourierStatus,
  processCourierWebhookUpdate,
  type CourierWebhookPayload,
} from '@/lib/courier-service';
import { getCourierWebhookSecret } from '@/lib/courier-webhook-secret';
import { logError, logWarn } from '@/lib/app-log';
import { logAdminAudit } from '@/lib/admin-audit';
import prisma from '@/lib/prisma';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

function getErrorStatus(error: unknown): number {
  if (isRecord(error) && typeof error.status === 'number') {
    return error.status;
  }

  return 500;
}

async function validateCourierWebhookSecret(request: Request): Promise<NextResponse | null> {
  const configuredSecret = await getCourierWebhookSecret();

  if (!configuredSecret) {
    if (process.env.NODE_ENV === 'production') {
      logWarn('Courier Webhook API', 'Courier webhook secret is not configured; rejecting courier webhook.');
      return NextResponse.json(
        { error: 'Courier webhook is not configured.' },
        { status: 503 },
      );
    }

    return null;
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const headerSecret = request.headers.get('x-courier-webhook-secret')?.trim() || bearerToken;

  if (headerSecret !== configuredSecret) {
    return NextResponse.json({ error: 'Unauthorized courier webhook.' }, { status: 401 });
  }

  return null;
}

function parseCourierWebhookPayload(value: unknown): CourierWebhookPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const orderId = typeof value.orderId === 'number' ? value.orderId : Number(value.orderId);
  const provider = value.provider;
  const trackingNumber = typeof value.trackingNumber === 'string' ? value.trackingNumber.trim() : '';
  const status = typeof value.status === 'string' ? value.status.trim() : '';
  const notes = typeof value.notes === 'string' ? value.notes.trim() : null;
  const failureReason = typeof value.failureReason === 'string' ? value.failureReason.trim() : null;

  if (
    !Number.isInteger(orderId) ||
    orderId <= 0 ||
    (provider !== 'koombiyo' && provider !== 'prompt' && provider !== 'royalexpress') ||
    !trackingNumber ||
    !status
  ) {
    return null;
  }

  return {
    orderId,
    provider,
    trackingNumber,
    status,
    notes,
    failureReason,
  };
}

function compactPayload(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return String(value).slice(0, 8000);
  }
}

export async function POST(request: Request) {
  let eventLogId: number | null = null;
  let body: CourierWebhookPayload | null = null;

  try {
    const authError = await validateCourierWebhookSecret(request);
    if (authError) {
      return authError;
    }

    const rawPayload = await request.json();
    body = parseCourierWebhookPayload(rawPayload);

    if (!body) {
      return NextResponse.json(
        { error: 'Invalid payload fields (orderId, provider, trackingNumber, status).' },
        { status: 400 },
      );
    }

    const mappedStatus = mapCourierStatus(body.provider, body.status);
    const orderForLog = await prisma.order.findUnique({
      where: { id: body.orderId },
      select: { id: true, brand: true },
    });
    const eventLog = await prisma.courierWebhookEventLog.create({
      data: {
        orderId: orderForLog?.id ?? null,
        provider: body.provider,
        trackingNumber: body.trackingNumber,
        courierStatus: body.status,
        mappedStatus,
        status: 'received',
        payload: compactPayload(rawPayload),
      },
    });
    eventLogId = eventLog.id;

    const result = await processCourierWebhookUpdate(body);
    const logStatus =
      result.fromStatus === result.toStatus && result.notificationDeduped
        ? 'skipped'
        : 'processed';

    await prisma.courierWebhookEventLog.update({
      where: { id: eventLogId },
      data: {
        status: logStatus,
        processedAt: new Date(),
      },
    });
    await logAdminAudit({
      action: 'courier_webhook_processed',
      entityType: 'order',
      entityId: result.orderId,
      brand: orderForLog?.brand ?? null,
      summary: `Courier webhook ${logStatus} order #${result.orderId}: ${body.provider} ${body.status} -> ${result.toStatus}.`,
      metadata: {
        provider: body.provider,
        trackingNumber: body.trackingNumber,
        courierStatus: body.status,
        mappedStatus: result.toStatus,
        customerNotified: result.customerNotified,
        notificationDeduped: result.notificationDeduped,
      },
    });

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      customerNotified: result.customerNotified,
      notificationDeduped: result.notificationDeduped,
    });
  } catch (error: unknown) {
    logError('Courier Webhook API', 'Failed to process automated courier status callback.', error);
    if (eventLogId) {
      await prisma.courierWebhookEventLog.update({
        where: { id: eventLogId },
        data: {
          status: 'failed',
          error: getErrorMessage(error),
          processedAt: new Date(),
        },
      });
      await logAdminAudit({
        action: 'courier_webhook_failed',
        entityType: 'order',
        entityId: body?.orderId ?? null,
        summary: `Courier webhook failed${body?.orderId ? ` for order #${body.orderId}` : ''}: ${getErrorMessage(error)}.`,
        metadata: body
          ? {
              provider: body.provider,
              trackingNumber: body.trackingNumber,
              courierStatus: body.status,
            }
          : undefined,
      });
    }
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) },
    );
  }
}
