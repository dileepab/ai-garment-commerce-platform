import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import {
  deleteOperatorPushSubscription,
  getOperatorPushSubscription,
  getPushPublicKey,
  isPushConfigured,
  saveOperatorPushSubscription,
  updateOperatorPushPreferences,
} from '@/lib/push-notifications';

export const dynamic = 'force-dynamic';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function operatorEmail(scope: { email?: string | null; id?: string | null }): string {
  // Shortcut users are keyed `user:<email>`; fall back to it when the session
  // carries no separate email so a subscription always has an owner.
  return readString(scope.email) || readString(scope.id);
}

/** What this browser currently has switched on, plus the key it subscribes with. */
export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('support:view');
    const endpoint = new URL(request.url).searchParams.get('endpoint');

    const subscription = endpoint
      ? await getOperatorPushSubscription({ endpoint, operatorEmail: operatorEmail(scope) })
      : null;

    return NextResponse.json({
      success: true,
      data: {
        configured: isPushConfigured(),
        publicKey: getPushPublicKey(),
        subscription,
      },
    });
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    return NextResponse.json({ success: false, error: 'Could not read notification settings.' }, { status: 500 });
  }
}

/** Turns notifications on for this browser, or saves a change to the toggles. */
export async function PUT(request: Request) {
  try {
    const scope = await requireApiPermission('support:view');

    if (!isPushConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Push notifications are not configured on the server.' },
        { status: 503 }
      );
    }

    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
    }

    const endpoint = readString(body.endpoint);
    if (!endpoint) {
      return NextResponse.json({ success: false, error: 'A subscription endpoint is required.' }, { status: 400 });
    }

    const notifyEscalations = body.notifyEscalations !== false;
    const notifyAllMessages = body.notifyAllMessages === true;

    const keys = isRecord(body.keys) ? body.keys : null;
    const p256dh = readString(keys?.p256dh);
    const auth = readString(keys?.auth);

    // Only the toggles changed: the browser sends no keys, and the row is
    // matched on the signed-in operator so one login cannot retune another's.
    if (!p256dh || !auth) {
      const updated = await updateOperatorPushPreferences({
        endpoint,
        operatorEmail: operatorEmail(scope),
        notifyEscalations,
        notifyAllMessages,
      });

      if (!updated) {
        return NextResponse.json(
          { success: false, error: 'This browser is not subscribed to notifications.' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true });
    }

    await saveOperatorPushSubscription({
      endpoint,
      p256dh,
      auth,
      operatorEmail: operatorEmail(scope),
      brands: scope.brands,
      deviceLabel: readString(body.deviceLabel) || null,
      notifyEscalations,
      notifyAllMessages,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    return NextResponse.json({ success: false, error: 'Could not save notification settings.' }, { status: 500 });
  }
}

/** Turns notifications off for this browser. */
export async function DELETE(request: Request) {
  try {
    await requireApiPermission('support:view');
    const endpoint = new URL(request.url).searchParams.get('endpoint');

    if (!endpoint) {
      return NextResponse.json({ success: false, error: 'A subscription endpoint is required.' }, { status: 400 });
    }

    await deleteOperatorPushSubscription(endpoint);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    return NextResponse.json({ success: false, error: 'Could not remove notification settings.' }, { status: 500 });
  }
}
