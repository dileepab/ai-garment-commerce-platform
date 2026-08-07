import { logDebug, logError } from '@/lib/app-log';
import { describeMetaGraphError } from '@/lib/meta-error';
import type { MetaQuickReply, MetaSendResult } from '@/lib/meta';
import { getPublicAssetUrl } from '@/lib/runtime-config';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const MAX_INBOUND_IMAGE_BYTES = 6 * 1024 * 1024;

export interface WhatsAppSendOptions {
  phoneNumberId: string;
  accessToken: string;
  quickReplies?: MetaQuickReply[];
}

function getPayloadError(data: unknown): string | undefined {
  return describeMetaGraphError(data);
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function cleanQuickReplies(options?: MetaQuickReply[]): MetaQuickReply[] {
  return (options ?? [])
    .map((option) => ({
      title: option.title.trim().slice(0, 24),
      payload: option.payload.trim().slice(0, 200),
    }))
    .filter((option) => option.title && option.payload)
    .slice(0, 10);
}

export function buildWhatsAppTextPayload(
  recipient: string,
  messageText: string,
  quickReplies?: MetaQuickReply[]
): Record<string, unknown> {
  const options = cleanQuickReplies(quickReplies);
  const base = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
  };

  if (options.length > 0 && options.length <= 3) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: messageText },
        action: {
          buttons: options.map((option) => ({
            type: 'reply',
            reply: {
              id: option.payload,
              title: option.title.slice(0, 20),
            },
          })),
        },
      },
    };
  }

  if (options.length > 3) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: messageText },
        action: {
          button: 'Choose an option',
          sections: [{
            title: 'Options',
            rows: options.map((option) => ({
              id: option.payload,
              title: option.title,
            })),
          }],
        },
      },
    };
  }

  return {
    ...base,
    type: 'text',
    text: {
      preview_url: false,
      body: messageText,
    },
  };
}

async function sendWhatsAppPayload(
  payload: Record<string, unknown>,
  options: WhatsAppSendOptions,
  payloadType: string
): Promise<MetaSendResult> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${options.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await readResponseBody(response);

    if (!response.ok) {
      logError('WhatsApp', 'Message send failed.', {
        phoneNumberId: options.phoneNumberId,
        payloadType,
        status: response.status,
        data,
      });
      return {
        ok: false,
        status: response.status,
        error: getPayloadError(data) || `Meta Graph returned ${response.status}.`,
        data,
      };
    }

    logDebug('WhatsApp', 'Message sent successfully.', {
      phoneNumberId: options.phoneNumberId,
      payloadType,
      status: response.status,
    });
    return { ok: true, status: response.status, data };
  } catch (error) {
    logError('WhatsApp', 'Message send failed before Meta responded.', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown WhatsApp send error.',
    };
  }
}

export function sendWhatsAppMessage(
  recipient: string,
  messageText: string,
  options: WhatsAppSendOptions
): Promise<MetaSendResult> {
  return sendWhatsAppPayload(
    buildWhatsAppTextPayload(recipient, messageText, options.quickReplies),
    options,
    options.quickReplies?.length ? 'interactive' : 'text'
  );
}

function absoluteMediaUrl(pathOrUrl: string): string | null {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return getPublicAssetUrl(pathOrUrl);
}

export function sendWhatsAppImage(
  recipient: string,
  imagePathOrUrl: string,
  options: WhatsAppSendOptions,
  caption?: string
): Promise<MetaSendResult> {
  const link = absoluteMediaUrl(imagePathOrUrl);
  if (!link) {
    return Promise.resolve({
      ok: false,
      error: `WhatsApp image could not be sent for ${imagePathOrUrl}. Configure APP_BASE_URL.`,
    });
  }

  return sendWhatsAppPayload(
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'image',
      image: {
        link,
        ...(caption ? { caption: caption.slice(0, 1024) } : {}),
      },
    },
    options,
    'image'
  );
}

export async function downloadWhatsAppImageAsDataUrl(
  mediaId: string,
  accessToken: string
): Promise<string | null> {
  try {
    const metadataResponse = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const metadata = await metadataResponse.json() as {
      url?: string;
      mime_type?: string;
      file_size?: number;
      error?: { message?: string };
    };

    if (!metadataResponse.ok || !metadata.url) {
      logError('WhatsApp', 'Could not resolve inbound image media.', {
        mediaId,
        status: metadataResponse.status,
        error: metadata.error?.message,
      });
      return null;
    }

    if (metadata.file_size && metadata.file_size > MAX_INBOUND_IMAGE_BYTES) {
      logError('WhatsApp', 'Inbound image exceeds the supported size.', {
        mediaId,
        fileSize: metadata.file_size,
      });
      return null;
    }

    const mediaResponse = await fetch(metadata.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaResponse.ok) {
      logError('WhatsApp', 'Could not download inbound image media.', {
        mediaId,
        status: mediaResponse.status,
      });
      return null;
    }

    const bytes = Buffer.from(await mediaResponse.arrayBuffer());
    if (bytes.length > MAX_INBOUND_IMAGE_BYTES) return null;
    const mimeType = mediaResponse.headers.get('content-type')?.split(';')[0] || metadata.mime_type || 'image/jpeg';
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  } catch (error) {
    logError('WhatsApp', 'Inbound image resolution failed.', error);
    return null;
  }
}
