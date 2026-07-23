import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import {
  loadSupportInbox,
  SupportInboxError,
} from '@/lib/support-inbox';

export const dynamic = 'force-dynamic';

function parseOptionalPositiveInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new SupportInboxError('Limit must be a positive integer.');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SupportInboxError('Limit must be a positive integer.');
  }
  return parsed;
}

export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('support:view');
    const { searchParams } = new URL(request.url);
    const includeMessages = ['1', 'true'].includes(
      (searchParams.get('includeMessages') ?? '').toLowerCase()
    );
    const { threads, stats } = await loadSupportInbox({
      scope,
      selectedBrand: searchParams.get('brand'),
      includeMessages,
      conversationLimit: parseOptionalPositiveInt(searchParams.get('limit')),
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          conversations: threads,
          stats,
        },
      },
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
