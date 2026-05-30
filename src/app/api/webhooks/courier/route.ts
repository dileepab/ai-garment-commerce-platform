import { NextResponse } from 'next/server';
import { processCourierWebhookUpdate, type CourierWebhookPayload } from '@/lib/courier-service';
import { logError } from '@/lib/app-log';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CourierWebhookPayload;

    // Validate request structure
    if (!body.orderId || !body.provider || !body.trackingNumber || !body.status) {
      return NextResponse.json(
        { error: 'Missing required payload fields (orderId, provider, trackingNumber, status).' },
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
  } catch (error: any) {
    logError('Courier Webhook API', 'Failed to process automated courier status callback.', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: error.status || 500 },
    );
  }
}
