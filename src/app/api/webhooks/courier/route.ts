import { NextResponse } from 'next/server';
import { processCourierWebhookUpdate, type CourierWebhookPayload } from '@/lib/courier-service';
import { logError, logWarn } from '@/lib/app-log';

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

function validateCourierWebhookSecret(request: Request): NextResponse | null {
  const configuredSecret = process.env.COURIER_WEBHOOK_SECRET?.trim();

  if (!configuredSecret) {
    if (process.env.NODE_ENV === 'production') {
      logWarn('Courier Webhook API', 'COURIER_WEBHOOK_SECRET is not configured; rejecting courier webhook.');
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
    (provider !== 'koombiyo' && provider !== 'prompt') ||
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

export async function POST(request: Request) {
  try {
    const authError = validateCourierWebhookSecret(request);
    if (authError) {
      return authError;
    }

    const body = parseCourierWebhookPayload(await request.json());

    if (!body) {
      return NextResponse.json(
        { error: 'Invalid payload fields (orderId, provider, trackingNumber, status).' },
        { status: 400 },
      );
    }

    const result = await processCourierWebhookUpdate(body);

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
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) },
    );
  }
}
