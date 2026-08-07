import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CustomerLanguage } from '@/lib/chat/language';
import { isInstagramLoginAccessToken } from '@/lib/meta-auth';
import {
  formatCarouselSubtitle,
  getCarouselButtonTitle,
  getCarouselDetailsButtonTitle,
} from '@/lib/chat/language';
import { logDebug, logError, logInfo, logWarn } from '@/lib/app-log';
import { describeMetaGraphError } from '@/lib/meta-error';
import { getPublicAssetUrl } from '@/lib/runtime-config';
import {
  buildInstagramProfileRequest,
  buildMessengerProfileRequest,
  parseInstagramUserProfile,
  parseMessengerUserProfile,
  type InstagramUserProfile,
  type MessengerUserProfile,
} from '@/lib/meta-profile';

const reusableAttachmentCache = new Map<string, string>();
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

export interface MetaSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
}

export interface MetaQuickReply {
  title: string;
  payload: string;
}

interface MessengerSendOptions {
  payloadType: string;
  pageAccessToken?: string;
  logLabel?: string;
}

export interface MetaPageTokenOptions {
  pageAccessToken?: string | null;
  language?: CustomerLanguage;
  quickReplies?: MetaQuickReply[];
}

function buildQuickReplies(options?: MetaQuickReply[]): Array<Record<string, string>> | undefined {
  const quickReplies = (options ?? [])
    .map((option) => ({
      content_type: 'text',
      title: option.title.trim().slice(0, 20),
      payload: option.payload.trim(),
    }))
    .filter((option) => option.title && option.payload)
    .slice(0, 13);

  return quickReplies.length > 0 ? quickReplies : undefined;
}

function buildTextMessagePayload(messageText: string, options?: MetaPageTokenOptions) {
  const quickReplies = buildQuickReplies(options?.quickReplies);
  return {
    text: messageText,
    ...(quickReplies ? { quick_replies: quickReplies } : {}),
  };
}

function getMimeType(filePath: string): string {
  if (filePath.endsWith('.png')) {
    return 'image/png';
  }

  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (filePath.endsWith('.webp')) {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

function resolvePublicFilePath(publicPath: string): string {
  const normalizedPath = publicPath.startsWith('/') ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), 'public', normalizedPath);
}

function getPayloadError(data: unknown): string | undefined {
  return describeMetaGraphError(data);
}

async function readGraphResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sendMessengerPayload(
  senderId: string,
  payload: Record<string, unknown>,
  options: MessengerSendOptions
): Promise<MetaSendResult> {
  const PAGE_ACCESS_TOKEN = options.pageAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) {
    logError('Meta', 'Missing META_PAGE_ACCESS_TOKEN in environment variables.');
    return {
      ok: false,
      error: 'META_PAGE_ACCESS_TOKEN is missing.',
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: senderId },
        ...payload,
      }),
    });

    const data = await readGraphResponseBody(response);
    if (!response.ok) {
      logError('Meta', `${options.logLabel || 'Messenger'} send failed.`, {
        senderId,
        payloadType: options.payloadType,
        status: response.status,
        data,
      });
      return {
        ok: false,
        status: response.status,
        error: getPayloadError(data) || `Meta Graph returned ${response.status}.`,
        data,
      };
    } else {
      logDebug('Meta', `${options.logLabel || 'Messenger'} sent successfully.`, {
        senderId,
        payloadType: options.payloadType,
        status: response.status,
      });
      return {
        ok: true,
        status: response.status,
        data,
      };
    }
  } catch (error) {
    logError('Meta', 'Error sending message to Meta.', {
      senderId,
      payloadType: options.payloadType,
      error,
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Meta send error.',
    };
  }
}

export async function sendMessengerMessage(
  senderId: string,
  messageText: string,
  options?: MetaPageTokenOptions,
) {
  return sendMessengerPayload(
    senderId,
    {
      message: buildTextMessagePayload(messageText, options),
    },
    { payloadType: 'text', pageAccessToken: options?.pageAccessToken ?? undefined }
  );
}

export async function sendInstagramMessage(
  senderId: string,
  instagramAccountId: string,
  messageText: string,
  options?: MetaPageTokenOptions,
) {
  const ACCESS_TOKEN = options?.pageAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

  if (!ACCESS_TOKEN) {
    logError('Meta', 'Missing Instagram access token for Instagram message send.');
    return {
      ok: false,
      error: 'Instagram access token is missing.',
    } satisfies MetaSendResult;
  }

  const payload = {
    recipient: { id: senderId },
    message: buildTextMessagePayload(messageText, options),
  };

  if (!isInstagramLoginAccessToken(ACCESS_TOKEN)) {
    const facebookResult = await sendMessengerPayload(senderId, payload, {
      payloadType: 'instagram_text_facebook_login',
      pageAccessToken: ACCESS_TOKEN,
      logLabel: 'Instagram text',
    });

    if (facebookResult.ok) {
      logInfo('Meta', 'Instagram text message sent successfully.', {
        senderId,
        instagramAccountId,
        endpointHost: 'graph.facebook.com',
        authFlow: 'facebook_login',
        status: facebookResult.status,
      });
    }

    return facebookResult;
  }

  const instagramEndpoints = [
    `https://graph.instagram.com/${META_GRAPH_VERSION}/${instagramAccountId}/messages`,
    `https://graph.instagram.com/${META_GRAPH_VERSION}/me/messages`,
  ];
  let lastFailure: MetaSendResult | null = null;

  for (const [index, endpoint] of instagramEndpoints.entries()) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await readGraphResponseBody(response);

      if (response.ok) {
        logInfo('Meta', 'Instagram text message sent successfully.', {
          senderId,
          instagramAccountId,
          endpointHost: new URL(endpoint).host,
          authFlow: 'instagram_login',
          status: response.status,
        });
        return { ok: true, status: response.status, data } satisfies MetaSendResult;
      }

      lastFailure = {
        ok: false,
        status: response.status,
        error: getPayloadError(data) || `Meta Graph returned ${response.status}.`,
        data,
      };
      const logContext = {
        senderId,
        instagramAccountId,
        endpointHost: new URL(endpoint).host,
        authFlow: 'instagram_login',
        attemptNumber: index + 1,
        status: response.status,
        error: lastFailure.error,
      };

      if (index < instagramEndpoints.length - 1) {
        logWarn('Meta', 'Instagram Login endpoint failed; trying one alternate endpoint.', logContext);
      } else {
        logError('Meta', 'Instagram text send failed.', logContext);
      }
    } catch (error) {
      lastFailure = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown Instagram send error.',
      };
      const logContext = {
        senderId,
        instagramAccountId,
        endpointHost: new URL(endpoint).host,
        authFlow: 'instagram_login',
        attemptNumber: index + 1,
        error: lastFailure.error,
      };

      if (index < instagramEndpoints.length - 1) {
        logWarn('Meta', 'Instagram Login request errored; trying one alternate endpoint.', logContext);
      } else {
        logError('Meta', 'Error sending Instagram text message.', logContext);
      }
    }
  }

  return lastFailure || {
    ok: false,
    error: 'Instagram text delivery failed.',
  };
}

interface CarouselProduct {
  id: number;
  name: string;
  price: number;
  sizes: string;
  colors: string;
  imageUrl?: string;
}

function buildOrderNowPayload(product: CarouselProduct): string {
  const encodedName = encodeURIComponent(product.name);
  return `ORDER_NOW|productId=${product.id}|productName=${encodedName}`;
}

function buildProductDetailsPayload(product: CarouselProduct): string {
  const encodedName = encodeURIComponent(product.name);
  return `PRODUCT_DETAILS|productId=${product.id}|productName=${encodedName}`;
}

export async function sendMessengerCarousel(
  senderId: string,
  products: CarouselProduct[],
  options?: MetaPageTokenOptions,
) {
  if (products.length === 0) {
    return { ok: true } satisfies MetaSendResult;
  }

  const language = options?.language || 'english';
  const elements = products.map((product) => ({
    title: `${product.name} (Rs ${product.price})`,
    image_url: product.imageUrl
      ? (/^https?:\/\//i.test(product.imageUrl) ? product.imageUrl : getPublicAssetUrl(product.imageUrl))
        || 'https://placehold.co/600x400/png'
      : 'https://placehold.co/600x400/png',
    subtitle: formatCarouselSubtitle(product, language),
    buttons: [
      {
        type: 'postback',
        title: getCarouselDetailsButtonTitle(language),
        payload: buildProductDetailsPayload(product),
      },
      {
        type: 'postback',
        title: getCarouselButtonTitle(language),
        payload: buildOrderNowPayload(product),
      },
    ],
  })).slice(0, 10); // Meta graph API limits generic templates to 10 elements

  return sendMessengerPayload(
    senderId,
    {
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements,
          },
        },
      },
    },
    { payloadType: 'carousel', pageAccessToken: options?.pageAccessToken ?? undefined }
  );
}

async function uploadReusableMessengerAttachment(
  publicPath: string,
  options?: MetaPageTokenOptions,
): Promise<string | null> {
  const PAGE_ACCESS_TOKEN = options?.pageAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) {
    logError('Meta', 'Missing META_PAGE_ACCESS_TOKEN in environment variables.');
    return null;
  }

  const cacheKey = `${publicPath}:${PAGE_ACCESS_TOKEN.slice(-8)}`;
  const cachedAttachmentId = reusableAttachmentCache.get(cacheKey);
  if (cachedAttachmentId) {
    return cachedAttachmentId;
  }

  try {
    const filePath = resolvePublicFilePath(publicPath);
    const fileBuffer = await readFile(filePath);
    const formData = new FormData();

    formData.append(
      'message',
      JSON.stringify({
        attachment: {
          type: 'image',
          payload: {
            is_reusable: true,
          },
        },
      })
    );

    formData.append(
      'filedata',
      new Blob([fileBuffer], { type: getMimeType(filePath) }),
      path.basename(filePath)
    );

    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/me/message_attachments?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const data = await response.json();
    if (!response.ok) {
      logError('Meta', `Reusable attachment upload failed for ${publicPath}.`, data);
      return null;
    }

    const attachmentId =
      typeof data?.attachment_id === 'string' ? data.attachment_id : null;

    if (attachmentId) {
      reusableAttachmentCache.set(cacheKey, attachmentId);
    }

    return attachmentId;
  } catch (error) {
    logError('Meta', `Error uploading Messenger attachment for ${publicPath}.`, error);
    return null;
  }
}

export async function sendMessengerImage(
  senderId: string,
  imagePathOrUrl: string,
  options?: MetaPageTokenOptions,
) {
  if (/^https?:\/\//i.test(imagePathOrUrl)) {
    return sendMessengerPayload(
      senderId,
      {
        message: {
          attachment: {
            type: 'image',
            payload: {
              url: imagePathOrUrl,
              is_reusable: true,
            },
          },
        },
      },
      { payloadType: 'image_url', pageAccessToken: options?.pageAccessToken ?? undefined }
    );
  }

  const attachmentId = await uploadReusableMessengerAttachment(imagePathOrUrl, options);

  if (attachmentId) {
    return sendMessengerPayload(
      senderId,
      {
        message: {
          attachment: {
            type: 'image',
            payload: {
              attachment_id: attachmentId,
            },
          },
        },
      },
      { payloadType: 'image_attachment', pageAccessToken: options?.pageAccessToken ?? undefined }
    );
  }

  const publicUrl = getPublicAssetUrl(imagePathOrUrl);

  if (publicUrl) {
    logDebug('Meta', `Falling back to public asset URL for ${imagePathOrUrl}.`);
    return sendMessengerPayload(
      senderId,
      {
        message: {
          attachment: {
            type: 'image',
            payload: {
              url: publicUrl,
              is_reusable: true,
            },
          },
        },
      },
      { payloadType: 'image_public_url', pageAccessToken: options?.pageAccessToken ?? undefined }
    );
  }

  logError(
    'Meta',
    `Messenger image could not be sent for ${imagePathOrUrl}. Configure APP_BASE_URL to enable public media fallback.`
  );
  return {
    ok: false,
    error: `Messenger image could not be sent for ${imagePathOrUrl}.`,
  } satisfies MetaSendResult;
}

export async function getMessengerUserProfile(
  senderId: string,
  options?: MetaPageTokenOptions,
): Promise<MessengerUserProfile | null> {
  const accessToken = options?.pageAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

  if (!accessToken) return null;

  try {
    const request = buildMessengerProfileRequest({
      graphVersion: META_GRAPH_VERSION,
      senderId,
      accessToken,
    });
    const response = await fetch(request.url, request.init);
    const data = await readGraphResponseBody(response);
    const profile = response.ok ? parseMessengerUserProfile(data) : null;

    if (profile) {
      logDebug('Meta', 'Loaded Messenger customer profile.');
      return profile;
    }

    logWarn('Meta', 'Messenger customer profile lookup was unavailable.', {
      status: response.status,
      error: getPayloadError(data),
    });
    return null;
  } catch (error) {
    logWarn('Meta', 'Messenger customer profile lookup failed.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getInstagramUserProfile(
  senderId: string,
  options?: MetaPageTokenOptions,
): Promise<InstagramUserProfile | null> {
  const accessToken = options?.pageAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

  if (!accessToken) return null;

  try {
    const useInstagramGraph = isInstagramLoginAccessToken(accessToken);
    const request = buildInstagramProfileRequest({
      graphVersion: META_GRAPH_VERSION,
      senderId,
      accessToken,
      useInstagramGraph,
    });
    const response = await fetch(request.url, request.init);
    const data = await readGraphResponseBody(response);
    const profile = response.ok ? parseInstagramUserProfile(data) : null;

    if (profile) {
      logDebug('Meta', 'Loaded Instagram customer profile.', {
        endpointHost: useInstagramGraph ? 'graph.instagram.com' : 'graph.facebook.com',
      });
      return profile;
    }

    logWarn('Meta', 'Instagram customer profile lookup was unavailable.', {
      endpointHost: useInstagramGraph ? 'graph.instagram.com' : 'graph.facebook.com',
      status: response.status,
      error: getPayloadError(data),
    });
    return null;
  } catch (error) {
    logWarn('Meta', 'Instagram customer profile lookup failed.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
