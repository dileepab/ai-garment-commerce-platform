import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CustomerLanguage } from '@/lib/chat/language';
import { formatCarouselSubtitle, getCarouselButtonTitle } from '@/lib/chat/language';
import { logDebug, logError } from '@/lib/app-log';
import { getPublicAssetUrl } from '@/lib/runtime-config';

const reusableAttachmentCache = new Map<string, string>();
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

export interface MetaSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
}

interface MessengerSendOptions {
  payloadType: string;
  pageAccessToken?: string;
}

export interface MetaPageTokenOptions {
  pageAccessToken?: string | null;
  language?: CustomerLanguage;
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
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error?: { message?: string } }).error;
    return error?.message;
  }

  return undefined;
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
      logError('Meta', 'Messenger send failed.', {
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
      logDebug('Meta', `Messenger ${options.payloadType} sent successfully to ${senderId}.`, {
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
      message: { text: messageText },
    },
    { payloadType: 'text', pageAccessToken: options?.pageAccessToken ?? undefined }
  );
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

export async function getUserProfile(
  senderId: string,
  options?: MetaPageTokenOptions,
): Promise<{ firstName: string; lastName: string; gender: string } | null> {
  const PAGE_ACCESS_TOKEN = options?.pageAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) return null;

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${senderId}?fields=first_name,last_name,gender&access_token=${PAGE_ACCESS_TOKEN}`
    );
    const data = await response.json();

    if (response.ok && data.first_name) {
      logDebug(
        'Meta',
        `Loaded Messenger profile for ${data.first_name} ${data.last_name || ''} (${data.gender || 'unknown'}).`
      );
      return {
        firstName: data.first_name,
        lastName: data.last_name || '',
        gender: data.gender || 'unknown',
      };
    }
    return null;
  } catch (error) {
    logError('Meta', `Error fetching user profile for sender ${senderId}.`, error);
    return null;
  }
}
