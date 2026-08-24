import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import {
  describeConversionsConfiguration,
  sendVerificationEvent,
} from '@/lib/meta-conversions';

export const dynamic = 'force-dynamic';

/** What is configured, so an empty variable cannot hide as a set one. */
export async function GET() {
  try {
    await requireApiPermission('settings:view');
    return NextResponse.json({ success: true, ...describeConversionsConfiguration() });
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    throw error;
  }
}

/**
 * Fires one synthetic Purchase against the live dataset.
 *
 * Uses the token already in the deployment, so proving the integration works
 * never requires anyone to handle the secret again.
 */
export async function POST(request: Request) {
  try {
    await requireApiPermission('settings:write');

    const body = await request.json().catch(() => ({}));
    const brand =
      typeof body?.brand === 'string' && body.brand.trim() ? body.brand.trim() : 'Happybuy';

    const result = await sendVerificationEvent(brand);

    return NextResponse.json(
      { success: result.ok, brand, ...result },
      // A refused token is not a bug in this route, so it answers 200 with the
      // detail rather than an error the browser hides.
      { status: 200 }
    );
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    throw error;
  }
}
