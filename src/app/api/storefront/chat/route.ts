import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { routeCustomerMessage } from '@/lib/chat-orchestrator';
import { getErrorMessage } from '@/lib/error-message';

interface StorefrontChatRequest {
  message?: string;
  senderId?: string;
  channel?: string;
  brand?: string;
  customerName?: string;
}

const BRAND_SLUG_TO_PLATFORM: Record<string, string> = {
  happybuy: 'Happyby',
  happyby: 'Happyby',
  cleopatra: 'Cleopatra',
  modabella: 'Modabella',
};

function getStableWebSenderId(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown-ip';
  const userAgent = request.headers.get('user-agent') || 'unknown-agent';
  const acceptLanguage = request.headers.get('accept-language') || 'unknown-language';

  return `web-${createHash('sha256')
    .update(`${forwardedFor}|${userAgent}|${acceptLanguage}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function normalizeBrand(value?: string | null): string | undefined {
  const compact = (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact ? BRAND_SLUG_TO_PLATFORM[compact] || value?.trim() : undefined;
}

function absoluteUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) {
    return null;
  }

  if (/^(https?:|data:)/i.test(value)) {
    return value;
  }

  return value.startsWith('/') ? `${origin}${value}` : value;
}

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as StorefrontChatRequest;
    const message = data.message?.trim();

    if (!message) {
      return NextResponse.json(
        { success: false, error: 'Message is required.' },
        { status: 400 }
      );
    }

    if (message.length > 1000) {
      return NextResponse.json(
        { success: false, error: 'Message is too long.' },
        { status: 400 }
      );
    }

    const origin = new URL(request.url).origin;
    const result = await routeCustomerMessage({
      senderId: data.senderId?.trim() || getStableWebSenderId(request),
      channel: data.channel?.trim() || 'web',
      currentMessage: message,
      brand: normalizeBrand(data.brand),
      customerName: data.customerName?.trim() || undefined,
    });

    return NextResponse.json({
      success: true,
      reply: result.reply ?? '',
      silentReason: result.silentReason ?? null,
      imageUrl: absoluteUrl(result.imagePath, origin),
      imageUrls: result.imagePaths?.map((imagePath) => absoluteUrl(imagePath, origin)).filter(Boolean) ?? null,
      carouselProducts:
        result.carouselProducts?.map((product) => ({
          ...product,
          imageUrl: absoluteUrl(product.imageUrl, origin),
        })) ?? null,
      orderId: result.orderId ?? null,
      language: result.language ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
