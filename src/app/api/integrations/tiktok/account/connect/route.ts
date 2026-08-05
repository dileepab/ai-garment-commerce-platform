import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import prisma from '@/lib/prisma';
import {
  buildTikTokAccountAuthorizationUrl,
  getTikTokAccountOAuthConfig,
  TIKTOK_ACCOUNT_CALLBACK_PATH,
  TIKTOK_ACCOUNT_OAUTH_NONCE_COOKIE,
} from '@/lib/tiktok-account-config';
import { createTikTokOAuthState } from '@/lib/tiktok-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function settingsRedirect(request: Request, error: string): NextResponse {
  const destination = new URL('/settings/tiktok', request.url);
  destination.searchParams.set('error', error);
  return NextResponse.redirect(destination, 303);
}

export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('settings:write');
    const brand = new URL(request.url).searchParams.get('brand')?.trim();
    if (!brand) return settingsRedirect(request, 'missing_brand');
    assertBrandAccess(scope, brand, 'TikTok Business Account connection');

    const existing = await prisma.tikTokAccountConnection.findUnique({
      where: { brand },
      select: { id: true },
    });
    if (existing) return settingsRedirect(request, 'account_disconnect_first');

    const config = getTikTokAccountOAuthConfig();
    const oauth = createTikTokOAuthState({
      brand,
      secret: config.tokenEncryptionKey,
    });
    const response = NextResponse.redirect(
      buildTikTokAccountAuthorizationUrl(config.authorizationUrl, oauth.state),
      303,
    );
    response.cookies.set(TIKTOK_ACCOUNT_OAUTH_NONCE_COOKIE, oauth.nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: TIKTOK_ACCOUNT_CALLBACK_PATH,
      expires: oauth.expiresAt,
    });
    return response;
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    return settingsRedirect(request, 'account_configuration');
  }
}
