import { NextResponse } from 'next/server';
import { assertBrandAccess, requireApiPermission } from '@/lib/authz';
import { logAdminAudit } from '@/lib/admin-audit';
import {
  exchangeTikTokAccountAuthorizationCode,
  revokeTikTokAccountAccessToken,
} from '@/lib/tiktok-account-api';
import {
  getTikTokAccountOAuthConfig,
  TIKTOK_ACCOUNT_CALLBACK_PATH,
  TIKTOK_ACCOUNT_OAUTH_NONCE_COOKIE,
} from '@/lib/tiktok-account-config';
import { saveTikTokAccountConnection } from '@/lib/tiktok-account-connection';
import { verifyTikTokOAuthState } from '@/lib/tiktok-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function callbackRedirect(
  request: Request,
  params: Record<string, string>,
): NextResponse {
  const destination = new URL('/settings/tiktok', request.url);
  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(destination, 303);
  response.cookies.set(TIKTOK_ACCOUNT_OAUTH_NONCE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: TIKTOK_ACCOUNT_CALLBACK_PATH,
    maxAge: 0,
  });
  return response;
}

function readCookie(request: Request, name: string): string | null {
  const encoded = request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state')?.trim();
  const authorizationCode = (
    searchParams.get('code') ?? searchParams.get('auth_code')
  )?.trim();
  const nonce = readCookie(request, TIKTOK_ACCOUNT_OAUTH_NONCE_COOKIE);
  if (searchParams.get('error') || !state || !authorizationCode || !nonce) {
    return callbackRedirect(request, { error: 'account_authorization_cancelled' });
  }

  let issuedAccessToken: string | null = null;
  let tokenPersisted = false;
  try {
    const config = getTikTokAccountOAuthConfig();
    const verifiedState = verifyTikTokOAuthState({
      state,
      expectedNonce: nonce,
      secret: config.tokenEncryptionKey,
    });
    const scope = await requireApiPermission('settings:write');
    assertBrandAccess(scope, verifiedState.brand, 'TikTok Business Account connection');
    const token = await exchangeTikTokAccountAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationCode,
      redirectUri: config.redirectUri,
      apiBaseUrl: config.apiBaseUrl,
    });
    issuedAccessToken = token.accessToken;
    const connection = await saveTikTokAccountConnection({
      brand: verifiedState.brand,
      token,
    });
    tokenPersisted = true;
    await logAdminAudit({
      action: 'tiktok_account_connected',
      entityType: 'tiktok_account_connection',
      entityId: connection.id,
      brand: verifiedState.brand,
      actorEmail: scope.email ?? null,
      summary: `Connected TikTok Business Account for ${verifiedState.brand}.`,
      metadata: {
        openId: connection.openId,
        scopes: token.scopes,
      },
    });
    return callbackRedirect(request, {
      status: 'account_connected',
      brand: verifiedState.brand,
    });
  } catch {
    if (issuedAccessToken && !tokenPersisted) {
      try {
        const config = getTikTokAccountOAuthConfig();
        await revokeTikTokAccountAccessToken({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          accessToken: issuedAccessToken,
          apiBaseUrl: config.apiBaseUrl,
        });
      } catch {
        // Best effort only; never expose the issued token or OAuth error.
      }
    }
    return callbackRedirect(request, { error: 'account_authorization_failed' });
  }
}
