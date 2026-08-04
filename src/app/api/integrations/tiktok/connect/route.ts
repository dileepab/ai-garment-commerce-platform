import { NextResponse } from 'next/server';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';
import { buildTikTokAuthorizationUrl } from '@/lib/tiktok-api';
import {
  getTikTokServerConfig,
  TIKTOK_CALLBACK_PATH,
  TIKTOK_OAUTH_NONCE_COOKIE,
} from '@/lib/tiktok-config';
import { createTikTokOAuthState } from '@/lib/tiktok-security';
import prisma from '@/lib/prisma';

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
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand')?.trim();
    if (!brand) return settingsRedirect(request, 'missing_brand');

    assertBrandAccess(scope, brand, 'TikTok Ads connection');
    const existingConnection = await prisma.tikTokConnection.findUnique({
      where: { brand },
      select: { id: true },
    });
    if (existingConnection) return settingsRedirect(request, 'disconnect_first');
    const config = getTikTokServerConfig();
    const oauth = createTikTokOAuthState({
      brand,
      secret: config.tokenEncryptionKey,
    });
    const authorizationUrl = buildTikTokAuthorizationUrl({
      appId: config.appId,
      redirectUri: config.redirectUri,
      state: oauth.state,
      scope: config.scope,
      authorizationUrl: config.authorizationUrl,
    });
    const response = NextResponse.redirect(authorizationUrl, 303);
    response.cookies.set(TIKTOK_OAUTH_NONCE_COOKIE, oauth.nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: TIKTOK_CALLBACK_PATH,
      expires: oauth.expiresAt,
    });
    return response;
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResponse(error);
    return settingsRedirect(request, 'configuration');
  }
}
