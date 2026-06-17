'use server';

import {
  resolveFacebookConfigForBrand,
  resolveInstagramConfigForBrand,
} from '@/lib/brand-channel-config';
import {
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

export type MetaConnectionChannel = 'facebook' | 'instagram';

export interface MetaConnectionTestResult {
  success: boolean;
  ok: boolean;
  brand: string;
  channel: MetaConnectionChannel;
  checkedAt: string;
  status?: number;
  id?: string;
  name?: string;
  username?: string;
  host?: string;
  error?: string;
}

interface MetaProfileResponse {
  id?: string;
  name?: string;
  username?: string;
  error?: {
    message?: string;
    code?: string | number;
    type?: string;
  };
}

function buildGraphUrl(host: string, objectId: string, accessToken: string, fields: string): string {
  const url = new URL(`https://${host}/${META_GRAPH_VERSION}/${objectId}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  return url.toString();
}

function metaErrorMessage(data: MetaProfileResponse, fallback: string): string {
  const prefix = data.error?.code ? `[${data.error.code}] ` : '';
  return `${prefix}${data.error?.message || fallback}`;
}

function maskMetaId(value?: string): string {
  if (!value) return 'unknown';
  if (value.length <= 8) return 'redacted';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function fetchMetaProfile(params: {
  host: string;
  objectId: string;
  accessToken: string;
  fields: string;
}): Promise<{ response: Response; data: MetaProfileResponse; host: string }> {
  const response = await fetch(
    buildGraphUrl(params.host, params.objectId, params.accessToken, params.fields),
    { method: 'GET', cache: 'no-store' },
  );
  const data = await response.json() as MetaProfileResponse;
  return { response, data, host: params.host };
}

export async function testMetaConnectionAction(
  brand: string,
  channel: MetaConnectionChannel,
): Promise<MetaConnectionTestResult> {
  const checkedAt = new Date().toISOString();

  try {
    const scope = await requireActionPermission('settings:write');
    assertBrandAccess(scope, brand, 'Meta channel');

    if (channel === 'facebook') {
      const config = await resolveFacebookConfigForBrand(brand);
      if (!config) {
        return {
          success: true,
          ok: false,
          brand,
          channel,
          checkedAt,
          error: 'Missing Facebook Page ID or Page access token.',
        };
      }

      const { response, data, host } = await fetchMetaProfile({
        host: 'graph.facebook.com',
        objectId: config.pageId,
        accessToken: config.pageAccessToken,
        fields: 'id,name',
      });

      return {
        success: true,
        ok: response.ok && data.id === config.pageId,
        brand,
        channel,
        checkedAt,
        status: response.status,
        id: data.id,
        name: data.name,
        host,
        error: response.ok
          ? data.id === config.pageId ? undefined : 'Token resolved, but not for the configured Facebook Page ID.'
          : metaErrorMessage(data, `Meta Graph returned ${response.status}.`),
      };
    }

    const config = await resolveInstagramConfigForBrand(brand);
    if (!config) {
      return {
        success: true,
        ok: false,
        brand,
        channel,
        checkedAt,
        error: 'Missing Instagram account ID or access token.',
      };
    }

    const facebookGraph = await fetchMetaProfile({
      host: 'graph.facebook.com',
      objectId: config.accountId,
      accessToken: config.accessToken,
      fields: 'id,username,name',
    });
    const tokenLooksLikeInstagramLogin = config.accessToken.trim().startsWith('IG');
    const result = facebookGraph.response.ok || !tokenLooksLikeInstagramLogin
      ? facebookGraph
      : await fetchMetaProfile({
          host: 'graph.instagram.com',
          objectId: config.accountId,
          accessToken: config.accessToken,
          fields: 'id,username',
        });

    return {
      success: true,
      ok: result.response.ok && result.data.id === config.accountId,
      brand,
      channel,
      checkedAt,
      status: result.response.status,
      id: result.data.id,
      name: result.data.name,
      username: result.data.username,
      host: result.host,
      error: result.response.ok
        ? result.data.id === config.accountId
          ? undefined
          : `Token is valid, but it resolved to Instagram account ${maskMetaId(result.data.id)} instead of configured account ${maskMetaId(config.accountId)}. Update the Instagram Account ID or save the token for the configured account.`
        : metaErrorMessage(result.data, `Meta Graph returned ${result.response.status}.`),
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      brand,
      channel,
      checkedAt,
      error: isAuthorizationError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Connection test failed.',
    };
  }
}
