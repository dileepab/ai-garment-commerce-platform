'use server';

import {
  resolveFacebookConfigForBrand,
  resolveInstagramConfigForBrand,
  resolveWhatsAppConfigForBrand,
} from '@/lib/brand-channel-config';
import { isInstagramLoginAccessToken } from '@/lib/meta-auth';
import {
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import { logAdminAudit } from '@/lib/admin-audit';
import {
  describeConversionsConfiguration,
  sendVerificationEvent,
} from '@/lib/meta-conversions';
import {
  CTWA_ATTRIBUTION_WINDOW_DAYS,
  isPlaceholderClickIdRejection,
} from '@/lib/meta-conversions-payload';
import prisma from '@/lib/prisma';
import {
  isValidWhatsAppRegistrationPin,
  registerWhatsAppPhone,
  subscribeWhatsAppBusinessAccount,
} from '@/lib/whatsapp-registration';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

export type MetaConnectionChannel = 'facebook' | 'instagram' | 'whatsapp';

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
  display_phone_number?: string;
  verified_name?: string;
  host?: string;
  error?: string;
}

export interface FacebookPagePost {
  id: string;
  message?: string;
  createdTime?: string;
  permalinkUrl?: string;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
  recentComments: Array<{
    id: string;
    message?: string;
    createdTime?: string;
  }>;
}

export interface FacebookPagePostsResult {
  success: boolean;
  ok: boolean;
  brand: string;
  checkedAt: string;
  pageId?: string;
  pageName?: string;
  posts: FacebookPagePost[];
  commentReadError?: string;
  error?: string;
}

export interface WhatsAppRegistrationActionResult {
  success: boolean;
  ok: boolean;
  brand: string;
  checkedAt: string;
  status?: number;
  errorCode?: string | number;
  error?: string;
}

export interface WhatsAppWebhookSubscriptionActionResult {
  success: boolean;
  ok: boolean;
  brand: string;
  checkedAt: string;
  status?: number;
  errorCode?: string | number;
  error?: string;
}

interface MetaProfileResponse {
  id?: string;
  name?: string;
  username?: string;
  display_phone_number?: string;
  verified_name?: string;
  error?: {
    message?: string;
    code?: string | number;
    type?: string;
  };
}

interface MetaSummaryField {
  data?: Array<{
    id?: string;
    message?: string;
    created_time?: string;
  }>;
  summary?: { total_count?: number };
}

interface MetaPagePostResponse {
  id?: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  reactions?: MetaSummaryField;
  comments?: MetaSummaryField;
  shares?: { count?: number };
}

interface MetaPagePostsResponse {
  data?: MetaPagePostResponse[];
  error?: MetaProfileResponse['error'];
}

interface MetaPageCommentsResponse extends MetaSummaryField {
  error?: MetaProfileResponse['error'];
}

function buildGraphUrl(host: string, objectId: string, fields: string): string {
  const url = new URL(`https://${host}/${META_GRAPH_VERSION}/${objectId}`);
  url.searchParams.set('fields', fields);
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
    buildGraphUrl(params.host, params.objectId, params.fields),
    {
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    },
  );
  const data = await response.json() as MetaProfileResponse;
  return { response, data, host: params.host };
}

export async function loadFacebookPagePostsAction(
  brand: string,
): Promise<FacebookPagePostsResult> {
  const checkedAt = new Date().toISOString();

  try {
    const scope = await requireActionPermission('settings:view');
    assertBrandAccess(scope, brand, 'Facebook Page posts');

    const config = await resolveFacebookConfigForBrand(brand);
    if (!config) {
      return {
        success: true,
        ok: false,
        brand,
        checkedAt,
        posts: [],
        error: 'Missing Facebook Page ID or Page access token.',
      };
    }

    const [profileResult, postsResponse] = await Promise.all([
      fetchMetaProfile({
        host: 'graph.facebook.com',
        objectId: config.pageId,
        accessToken: config.pageAccessToken,
        fields: 'id,name',
      }),
      fetch((() => {
        const url = new URL(
          `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.pageId}/posts`,
        );
        url.searchParams.set(
          'fields',
          'id,message,created_time,permalink_url,shares,reactions.limit(0).summary(true)',
        );
        url.searchParams.set('limit', '5');
        return url;
      })(), {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${config.pageAccessToken}` },
      }),
    ]);
    const postsData = await postsResponse.json() as MetaPagePostsResponse;

    if (!profileResult.response.ok) {
      return {
        success: true,
        ok: false,
        brand,
        checkedAt,
        posts: [],
        error: metaErrorMessage(
          profileResult.data,
          `Meta Graph returned ${profileResult.response.status} loading the Page.`,
        ),
      };
    }

    if (!postsResponse.ok) {
      return {
        success: true,
        ok: false,
        brand,
        checkedAt,
        pageId: profileResult.data.id,
        pageName: profileResult.data.name,
        posts: [],
        error: metaErrorMessage(
          postsData,
          `Meta Graph returned ${postsResponse.status} loading Page-authored posts. Confirm pages_read_engagement is granted to the token.`,
        ),
      };
    }

    const pagePosts = (postsData.data ?? [])
      .filter((post): post is MetaPagePostResponse & { id: string } => Boolean(post.id))
      .slice(0, 5);
    const commentResults = await Promise.all(pagePosts.map(async (post) => {
      const url = new URL(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${post.id}/comments`,
      );
      url.searchParams.set('fields', 'id,message,created_time');
      url.searchParams.set('limit', '3');
      url.searchParams.set('summary', 'true');
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${config.pageAccessToken}` },
      });
      const data = await response.json() as MetaPageCommentsResponse;
      return { response, data };
    }));
    const failedCommentResult = commentResults.find((result) => !result.response.ok);
    const posts = pagePosts.map((post, index) => {
      const comments = commentResults[index]?.response.ok
        ? commentResults[index].data
        : undefined;
      return {
        id: post.id,
        message: post.message,
        createdTime: post.created_time,
        permalinkUrl: post.permalink_url,
        reactionCount: post.reactions?.summary?.total_count ?? 0,
        commentCount: comments?.summary?.total_count ?? 0,
        shareCount: post.shares?.count ?? 0,
        recentComments: (comments?.data ?? [])
          .filter((comment): comment is { id: string; message?: string; created_time?: string } => Boolean(comment.id))
          .map((comment) => ({
            id: comment.id,
            message: comment.message,
            createdTime: comment.created_time,
          })),
      };
    });

    return {
      success: true,
      ok: true,
      brand,
      checkedAt,
      pageId: profileResult.data.id,
      pageName: profileResult.data.name,
      posts,
      commentReadError: failedCommentResult
        ? metaErrorMessage(
            failedCommentResult.data,
            'Meta did not allow user comments to be read. Grant pages_read_user_content to the Page token.',
          )
        : undefined,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      brand,
      checkedAt,
      posts: [],
      error: isAuthorizationError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not load Facebook Page posts.',
    };
  }
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

    if (channel === 'whatsapp') {
      const config = await resolveWhatsAppConfigForBrand(brand);
      if (!config) {
        return {
          success: true,
          ok: false,
          brand,
          channel,
          checkedAt,
          error: 'Missing WhatsApp Phone Number ID or access token.',
        };
      }

      const result = await fetchMetaProfile({
        host: 'graph.facebook.com',
        objectId: config.phoneNumberId,
        accessToken: config.accessToken,
        fields: 'id,display_phone_number,verified_name',
      });

      return {
        success: true,
        ok: result.response.ok && result.data.id === config.phoneNumberId,
        brand,
        channel,
        checkedAt,
        status: result.response.status,
        id: result.data.id,
        name: result.data.verified_name || result.data.display_phone_number,
        host: result.host,
        error: result.response.ok
          ? result.data.id === config.phoneNumberId
            ? undefined
            : 'Token resolved, but not for the configured WhatsApp Phone Number ID.'
          : metaErrorMessage(result.data, `Meta Graph returned ${result.response.status}.`),
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
    const tokenLooksLikeInstagramLogin = isInstagramLoginAccessToken(config.accessToken);
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

export async function registerWhatsAppPhoneAction(
  brand: string,
  pin: string,
): Promise<WhatsAppRegistrationActionResult> {
  const checkedAt = new Date().toISOString();

  try {
    const scope = await requireActionPermission('settings:write');
    assertBrandAccess(scope, brand, 'WhatsApp registration');

    if (!isValidWhatsAppRegistrationPin(pin)) {
      return {
        success: true,
        ok: false,
        brand,
        checkedAt,
        error: 'Enter exactly six digits for the WhatsApp two-step PIN.',
      };
    }

    const config = await resolveWhatsAppConfigForBrand(brand);
    if (!config) {
      return {
        success: true,
        ok: false,
        brand,
        checkedAt,
        error: 'Missing WhatsApp Phone Number ID or system-user token.',
      };
    }

    const result = await registerWhatsAppPhone({
      phoneNumberId: config.phoneNumberId,
      accessToken: config.accessToken,
      pin,
    });
    const maskedPhoneNumberId = maskMetaId(config.phoneNumberId);

    await logAdminAudit({
      action: result.ok
        ? 'whatsapp_phone_registered'
        : 'whatsapp_phone_registration_failed',
      entityType: 'whatsapp_phone_number',
      entityId: maskedPhoneNumberId,
      brand,
      actorEmail: scope.email ?? null,
      summary: result.ok
        ? `Registered the WhatsApp phone number for ${brand}.`
        : `WhatsApp phone registration failed for ${brand}.`,
      metadata: {
        phoneNumberId: maskedPhoneNumberId,
        graphVersion: META_GRAPH_VERSION,
        status: result.status,
        errorCode: result.errorCode ?? null,
      },
    });

    return {
      success: true,
      ok: result.ok,
      brand,
      checkedAt,
      status: result.status,
      errorCode: result.errorCode,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      brand,
      checkedAt,
      error: isAuthorizationError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'WhatsApp registration failed.',
    };
  }
}

export async function subscribeWhatsAppWebhooksAction(
  brand: string,
): Promise<WhatsAppWebhookSubscriptionActionResult> {
  const checkedAt = new Date().toISOString();

  try {
    const scope = await requireActionPermission('settings:write');
    assertBrandAccess(scope, brand, 'WhatsApp webhook subscription');

    const config = await resolveWhatsAppConfigForBrand(brand);
    if (!config?.businessAccountId) {
      return {
        success: true,
        ok: false,
        brand,
        checkedAt,
        error: 'Missing WhatsApp Business Account ID or system-user token.',
      };
    }

    const result = await subscribeWhatsAppBusinessAccount({
      businessAccountId: config.businessAccountId,
      accessToken: config.accessToken,
    });
    const maskedBusinessAccountId = maskMetaId(config.businessAccountId);

    await logAdminAudit({
      action: result.ok
        ? 'whatsapp_webhooks_subscribed'
        : 'whatsapp_webhook_subscription_failed',
      entityType: 'whatsapp_business_account',
      entityId: maskedBusinessAccountId,
      brand,
      actorEmail: scope.email ?? null,
      summary: result.ok
        ? `Subscribed ${brand} to WhatsApp webhooks.`
        : `WhatsApp webhook subscription failed for ${brand}.`,
      metadata: {
        businessAccountId: maskedBusinessAccountId,
        graphVersion: META_GRAPH_VERSION,
        status: result.status,
        errorCode: result.errorCode ?? null,
      },
    });

    return {
      success: true,
      ok: result.ok,
      brand,
      checkedAt,
      status: result.status,
      errorCode: result.errorCode,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      brand,
      checkedAt,
      error: isAuthorizationError(error)
        ? error.message
        : 'WhatsApp webhook subscription failed.',
    };
  }
}


export interface ConversionsApiTestResult {
  success: boolean;
  ok: boolean;
  brand: string;
  checkedAt: string;
  datasetIdSuffix: string;
  testEventCodeActive: boolean;
  missing: string[];
  status?: number;
  detail?: string;
  error?: string;
  /** Set when the run proved the credentials but not a real click id. */
  credentialsOnly?: boolean;
}

/**
 * Proves the Purchase event reaches Meta, using the token already deployed.
 *
 * The dataset stays empty until an ad-sourced customer buys something, so
 * without this there is no way to tell a working integration from one whose
 * token cannot write to the dataset — both look like nothing happening.
 */
export async function testConversionsApiAction(brand: string): Promise<ConversionsApiTestResult> {
  const checkedAt = new Date().toISOString();

  try {
    const scope = await requireActionPermission('settings:write');
    assertBrandAccess(scope, brand, 'Meta channel');

    const config = describeConversionsConfiguration();
    const missing = Object.entries(config.present)
      .filter(([, isPresent]) => !isPresent)
      .map(([name]) => name);

    const base = {
      success: true,
      brand,
      checkedAt,
      datasetIdSuffix: config.datasetIdSuffix,
      testEventCodeActive: config.testEventCodeActive,
      missing,
    };

    if (missing.length) {
      return { ...base, ok: false, error: `Not configured: ${missing.join(', ')}.` };
    }

    // A real click id is only used when the event goes to Test Events, where
    // Meta credits nothing. Sending a fabricated sale against a live ad would
    // put a purchase that never happened into the campaign's numbers.
    const realClickId = config.testEventCodeActive ? await recentAdClickId() : null;

    const result = await sendVerificationEvent(brand, realClickId);

    await logAdminAudit({
      action: 'meta.conversions.verify',
      brand,
      actorEmail: scope.email ?? null,
      // The outcome only; the verification payload carries no customer data.
      summary: `Conversions API check ${result.ok ? 'accepted' : 'rejected'} (status ${result.status}).`,
    });

    if (result.ok) return { ...base, ok: true, status: result.status };

    // Meta refusing the placeholder click id means the request already cleared
    // the dataset lookup and the token check — everything a synthetic event can
    // prove. Reporting that as a failure would send us hunting a working setup.
    if (!realClickId && isPlaceholderClickIdRejection(result.response)) {
      return { ...base, ok: true, status: result.status, credentialsOnly: true };
    }

    return {
      ...base,
      ok: false,
      status: result.status,
      detail: result.response,
      error:
        result.reason === 'no_waba_id'
          ? `No WhatsApp Business Account ID configured for ${brand}.`
          : result.reason === 'no_token'
            ? 'No Conversions API access token available.'
            : result.reason === 'network_error'
              ? 'Could not reach Meta.'
              : 'Meta rejected the event.',
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      brand,
      checkedAt,
      datasetIdSuffix: '',
      testEventCodeActive: false,
      missing: [],
      error: isAuthorizationError(error)
        ? error.message
        : 'Could not run the Conversions API check.',
    };
  }
}


/**
 * The newest ad click still inside the window Meta credits.
 *
 * Referrals carry no brand, so this is the newest across all of them. That is
 * accurate enough for a check whose event is discarded either way.
 */
async function recentAdClickId(): Promise<string | null> {
  const referral = await prisma.adReferral.findFirst({
    where: {
      clickId: { not: null },
      capturedAt: {
        gte: new Date(Date.now() - CTWA_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { capturedAt: 'desc' },
    select: { clickId: true },
  });

  return referral?.clickId ?? null;
}
