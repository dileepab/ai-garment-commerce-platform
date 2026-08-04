import { NextResponse } from 'next/server';
import { assertBrandAccess, requireApiPermission } from '@/lib/authz';
import { logAdminAudit } from '@/lib/admin-audit';
import {
  exchangeTikTokAuthorizationCode,
  listTikTokAdvertisers,
  revokeTikTokAccessToken,
  type TikTokAdvertiser,
} from '@/lib/tiktok-api';
import {
  getTikTokServerConfig,
  TIKTOK_CALLBACK_PATH,
  TIKTOK_OAUTH_NONCE_COOKIE,
} from '@/lib/tiktok-config';
import { resolveTikTokConnection, saveTikTokConnection } from '@/lib/tiktok-connection';
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
  response.cookies.set(TIKTOK_OAUTH_NONCE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: TIKTOK_CALLBACK_PATH,
    maxAge: 0,
  });
  return response;
}

function chooseAdvertiser(
  authorizedIds: string[],
  advertisers: TikTokAdvertiser[],
): TikTokAdvertiser | null {
  if (authorizedIds.length === 1) {
    return advertisers.find((advertiser) => advertiser.advertiserId === authorizedIds[0])
      ?? { advertiserId: authorizedIds[0], advertiserName: null };
  }
  if (authorizedIds.length === 0 && advertisers.length === 1) return advertisers[0];
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state')?.trim();
  const authorizationCode = searchParams.get('auth_code')?.trim();
  const nonceCookie = request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TIKTOK_OAUTH_NONCE_COOKIE}=`))
    ?.slice(TIKTOK_OAUTH_NONCE_COOKIE.length + 1);

  if (searchParams.get('error') || !state || !authorizationCode || !nonceCookie) {
    return callbackRedirect(request, { error: 'authorization_cancelled' });
  }

  let issuedAccessToken: string | null = null;
  let existingAccessToken: string | null = null;
  let tokenPersisted = false;

  try {
    const config = getTikTokServerConfig();
    const verifiedState = verifyTikTokOAuthState({
      state,
      expectedNonce: decodeURIComponent(nonceCookie),
      secret: config.tokenEncryptionKey,
    });
    const currentScope = await requireApiPermission('settings:write');
    assertBrandAccess(currentScope, verifiedState.brand, 'TikTok Ads connection');
    const existingConnection = await resolveTikTokConnection(verifiedState.brand);
    existingAccessToken = existingConnection?.accessToken ?? null;
    const token = await exchangeTikTokAuthorizationCode({
      appId: config.appId,
      appSecret: config.appSecret,
      authorizationCode,
      apiBaseUrl: config.apiBaseUrl,
    });
    issuedAccessToken = token.accessToken;

    let advertisers: TikTokAdvertiser[] = [];
    try {
      advertisers = (await listTikTokAdvertisers({
        appId: config.appId,
        appSecret: config.appSecret,
        accessToken: token.accessToken,
        apiBaseUrl: config.apiBaseUrl,
      })).advertisers;
    } catch {
      // The token remains usable if the advertiser lookup is temporarily
      // unavailable. Settings can retry the lookup after connection.
    }

    const selectedAdvertiser = chooseAdvertiser(token.advertiserIds, advertisers);
    if (existingAccessToken && existingAccessToken !== token.accessToken) {
      await revokeTikTokAccessToken({
        appId: config.appId,
        appSecret: config.appSecret,
        accessToken: existingAccessToken,
        apiBaseUrl: config.apiBaseUrl,
      });
    }
    const connection = await saveTikTokConnection({
      brand: verifiedState.brand,
      accessToken: token.accessToken,
      scopes: token.scopes,
      advertiserId: selectedAdvertiser?.advertiserId,
      advertiserName: selectedAdvertiser?.advertiserName,
    });
    tokenPersisted = true;
    await logAdminAudit({
      action: 'tiktok_connected',
      entityType: 'tiktok_connection',
      entityId: connection.id,
      brand: verifiedState.brand,
      actorEmail: currentScope?.email ?? null,
      summary: `Connected TikTok Ads for ${verifiedState.brand}.`,
      metadata: {
        advertiserId: selectedAdvertiser?.advertiserId ?? null,
        advertiserSelectionRequired: !selectedAdvertiser,
        previousTokenRevoked: Boolean(existingAccessToken && existingAccessToken !== token.accessToken),
        scopes: token.scopes,
      },
    });

    return callbackRedirect(request, {
      status: selectedAdvertiser ? 'connected' : 'select_advertiser',
      brand: verifiedState.brand,
    });
  } catch {
    if (issuedAccessToken && !tokenPersisted && issuedAccessToken !== existingAccessToken) {
      try {
        const config = getTikTokServerConfig();
        await revokeTikTokAccessToken({
          appId: config.appId,
          appSecret: config.appSecret,
          accessToken: issuedAccessToken,
          apiBaseUrl: config.apiBaseUrl,
        });
      } catch {
        // A second best-effort failure must not expose credentials in the URL
        // or response. The original OAuth attempt still reports a safe error.
      }
    }
    return callbackRedirect(request, { error: 'authorization_failed' });
  }
}
