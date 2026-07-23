import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import {
  createSupportConversationKey,
  loadSupportConversationMessages,
  SupportInboxError,
} from '@/lib/support-inbox';

export const dynamic = 'force-dynamic';

function parseOptionalPositiveInt(
  value: string | null,
  label: string
): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new SupportInboxError(`${label} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SupportInboxError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function resolveConversationKey(searchParams: URLSearchParams): {
  conversationKey: string;
  selectedBrand: string | null;
} {
  const suppliedKey = searchParams.get('conversationKey')?.trim();
  if (suppliedKey) {
    return {
      conversationKey: suppliedKey,
      selectedBrand:
        searchParams.get('selectedBrand') ?? searchParams.get('brand'),
    };
  }

  const senderId = searchParams.get('senderId')?.trim();
  const channel = searchParams.get('channel')?.trim();
  if (!senderId || !channel) {
    throw new SupportInboxError(
      'A conversationKey, or senderId and channel, is required.'
    );
  }

  const rawBrand = searchParams.get('brand');
  const brand = rawBrand?.trim() ? rawBrand.trim() : null;
  return {
    conversationKey: createSupportConversationKey({ brand, channel, senderId }),
    selectedBrand: brand,
  };
}

export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('support:view');
    const { searchParams } = new URL(request.url);
    const { conversationKey, selectedBrand } = resolveConversationKey(searchParams);
    const data = await loadSupportConversationMessages({
      scope,
      conversationKey,
      selectedBrand,
      beforeId: parseOptionalPositiveInt(searchParams.get('beforeId'), 'beforeId'),
      afterId: parseOptionalPositiveInt(searchParams.get('afterId'), 'afterId'),
      limit: parseOptionalPositiveInt(searchParams.get('limit'), 'limit'),
    });

    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    if (error instanceof SupportInboxError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
}
