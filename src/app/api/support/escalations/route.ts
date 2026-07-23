import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import { loadSupportInbox, SupportInboxError } from '@/lib/support-inbox';

export const dynamic = 'force-dynamic';

/**
 * Compatibility endpoint for older clients. The main inbox now uses
 * /api/support/conversations; this route intentionally returns case-backed
 * threads only under the historical `escalations` key.
 */
export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('support:view');
    const { searchParams } = new URL(request.url);
    const { threads, stats } = await loadSupportInbox({
      scope,
      selectedBrand: searchParams.get('brand'),
      includeMessages: false,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          escalations: threads.filter((thread) => thread.escalationId !== null),
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
