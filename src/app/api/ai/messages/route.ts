import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';

interface AiMessageRequest {
  message?: string;
  senderId?: string;
  channel?: string;
  brand?: string;
}

function getStableWebSenderId(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown-ip';
  const userAgent = request.headers.get('user-agent') || 'unknown-agent';
  const acceptLanguage = request.headers.get('accept-language') || 'unknown-language';

  return `web-${createHash('sha256')
    .update(`${forwardedFor}|${userAgent}|${acceptLanguage}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as AiMessageRequest;
    const customerMessage = data.message?.trim();
    const senderId = data.senderId?.trim() || getStableWebSenderId(request);
    const channel = data.channel?.trim() || 'web';
    const brand = data.brand?.trim();

    if (!customerMessage) {
      return NextResponse.json(
        { success: false, error: 'Message is required.' },
        { status: 400 }
      );
    }

    const result = await routeCustomerMessage({
      senderId,
      channel,
      currentMessage: customerMessage,
      brand,
    });

    return NextResponse.json({
      success: true,
      reply: result.reply,
      imageUrl: result.imagePath ?? null,
      imageUrls: result.imagePaths ?? null,
      orderId: result.orderId ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
