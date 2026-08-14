/**
 * Re-hosts an inbound chat photo on blob storage.
 *
 * Split from `inbound-image.ts` so the parsing rules stay testable without a
 * network or a blob token. This half is the part that can fail, and every
 * failure returns null: a customer's message must still be answered and
 * recorded when their photo cannot be stored. Losing the picture is a
 * disappointment; losing the message is a lost sale.
 */
import { logWarn } from '@/lib/app-log';
import {
  buildInboundImageKey,
  isFetchableImageUrl,
  parseImageDataUrl,
} from '@/lib/chat/inbound-image';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function storeInboundChatImage(params: {
  source: string | null | undefined;
  channel: string;
}): Promise<string | null> {
  const source = params.source?.trim();
  if (!source) return null;

  // Already ours: re-uploading a blob URL would duplicate it on every retry.
  if (source.includes('.public.blob.vercel-storage.com')) return source;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    logWarn('Inbound Image', 'BLOB_READ_WRITE_TOKEN is not set; the photo was not kept.', {
      channel: params.channel,
    });
    return null;
  }

  try {
    let body: Buffer;
    let mimeType: string;

    const dataUrl = parseImageDataUrl(source);

    if (dataUrl) {
      body = Buffer.from(dataUrl.base64, 'base64');
      mimeType = dataUrl.mimeType;
    } else if (isFetchableImageUrl(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        logWarn('Inbound Image', 'Could not fetch the photo to store it.', {
          channel: params.channel,
          status: response.status,
        });
        return null;
      }
      body = Buffer.from(await response.arrayBuffer());
      mimeType = response.headers.get('content-type') || 'image/jpeg';
    } else {
      return null;
    }

    if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
      logWarn('Inbound Image', 'Photo was empty or too large to store.', {
        channel: params.channel,
        bytes: body.byteLength,
      });
      return null;
    }

    const { put } = await import('@vercel/blob');
    const blob = await put(buildInboundImageKey({ channel: params.channel, mimeType }), body, {
      access: 'public',
      contentType: mimeType,
      addRandomSuffix: false,
    });

    return blob.url;
  } catch (error) {
    // Never rethrow: the message still has to be handled.
    logWarn('Inbound Image', 'Storing the photo failed; carrying on without it.', {
      channel: params.channel,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
