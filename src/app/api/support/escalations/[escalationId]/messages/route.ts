import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import {
  formatSupportTime,
  serializeSupportMessage,
  SUPPORT_THREAD_MESSAGE_LIMIT,
} from '@/app/support/format';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{
    escalationId: string;
  }>;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value: string | null): number {
  const parsed = parsePositiveInt(value);
  return Math.min(parsed ?? SUPPORT_THREAD_MESSAGE_LIMIT, 100);
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const scope = await requireApiPermission('support:view');
    const { escalationId } = await params;
    const id = Number.parseInt(escalationId, 10);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid escalation id.' },
        { status: 400 }
      );
    }

    const escalation = await prisma.supportEscalation.findUnique({
      where: { id },
      select: {
        id: true,
        senderId: true,
        channel: true,
        brand: true,
        status: true,
        latestCustomerMessage: true,
        summary: true,
        updatedAt: true,
        resolvedAt: true,
      },
    });

    if (!escalation) {
      return NextResponse.json(
        { success: false, error: 'Support case not found.' },
        { status: 404 }
      );
    }

    assertBrandAccess(scope, escalation.brand, 'support case');

    const { searchParams } = new URL(request.url);
    const beforeId = parsePositiveInt(searchParams.get('beforeId'));
    const afterId = parsePositiveInt(searchParams.get('afterId'));

    if (beforeId && afterId) {
      return NextResponse.json(
        { success: false, error: 'Use beforeId or afterId, not both.' },
        { status: 400 }
      );
    }

    const limit = parseLimit(searchParams.get('limit'));
    const shouldCheckOlder = !afterId;
    const messages = await prisma.chatMessage.findMany({
      where: {
        senderId: escalation.senderId,
        channel: escalation.channel,
        ...(beforeId ? { id: { lt: beforeId } } : {}),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: afterId ? 'asc' : 'desc' },
      take: shouldCheckOlder ? limit + 1 : limit,
    });

    const hasMoreOlder = shouldCheckOlder ? messages.length > limit : undefined;
    const visibleMessages = shouldCheckOlder ? messages.slice(0, limit).reverse() : messages;

    return NextResponse.json(
      {
        success: true,
        data: {
          messages: visibleMessages.map(serializeSupportMessage),
          hasMoreOlder,
          escalation: {
            id: escalation.id,
            status: escalation.status,
            latestCustomerMessage: escalation.latestCustomerMessage,
            summary: escalation.summary,
            updatedAt: escalation.updatedAt.toISOString(),
            updatedAtLabel: formatSupportTime(escalation.updatedAt),
            resolvedAt: escalation.resolvedAt?.toISOString() ?? null,
          },
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    throw error;
  }
}
