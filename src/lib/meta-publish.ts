import { logDebug, logError } from '@/lib/app-log';
import {
  resolveFacebookConfigForBrand,
  resolveInstagramConfigForBrand,
} from '@/lib/brand-channel-config';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

export interface PublishResult {
  ok: boolean;
  externalPostId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface PublishImageInput {
  url: string;
  description?: string;
}

interface MetaErrorPayload {
  error?: {
    code?: string | number;
    message?: string;
  };
}

interface MetaIdResponse extends MetaErrorPayload {
  id?: string;
}

interface FbAttachedMedia {
  media_fbid: string;
}

function getMetaErrorCode(data: MetaErrorPayload, fallback: string | number): string {
  return data.error?.code != null ? String(data.error.code) : String(fallback);
}

function getMetaErrorMessage(data: MetaErrorPayload, fallback: string): string {
  return data.error?.message ?? fallback;
}

// ── Facebook Page post ───────────────────────────────────────────────────────

export async function publishToFacebook(
  brand: string,
  caption: string,
  images?: PublishImageInput[],
): Promise<PublishResult> {
  const config = await resolveFacebookConfigForBrand(brand);
  if (!config) {
    logError('MetaPublish', `Missing Facebook publish config for brand "${brand}". Add a Facebook Page ID and token in Settings > Meta Channels.`);
    return {
      ok: false,
      errorCode: 'CONFIG_MISSING',
      errorMessage: `Facebook publish config not set for brand "${brand}". Configure Settings > Meta Channels.`,
    };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.pageId}/feed`;

  try {
    const attachedMedia: FbAttachedMedia[] = [];
    
    // Upload photos if any
    if (images && images.length > 0) {
      for (const image of images) {
        const body = new URLSearchParams({
          url: image.url,
          published: 'false',
          access_token: config.pageAccessToken,
        });
        if (image.description?.trim()) {
          body.set('caption', image.description.trim());
        }
        const photoRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${config.pageId}/photos`, {
          method: 'POST',
          body,
        });
        const photoData = await photoRes.json() as MetaIdResponse;
        if (photoRes.ok && photoData.id) {
          attachedMedia.push({ media_fbid: photoData.id });
        } else {
          logError('MetaPublish', `Failed to upload FB photo for brand "${brand}"`, photoData);
        }
      }

      if (attachedMedia.length === 0) {
        return {
          ok: false,
          errorCode: 'IMAGE_UPLOAD_FAILED',
          errorMessage: 'Facebook could not fetch any generated image URLs. Check APP_BASE_URL and the public creative image route.',
        };
      }
    }

    const payload: {
      message: string;
      access_token: string;
      attached_media?: FbAttachedMedia[];
    } = { message: caption, access_token: config.pageAccessToken };
    if (attachedMedia.length > 0) {
      payload.attached_media = attachedMedia;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const code = getMetaErrorCode(data, response.status);
      const msg = getMetaErrorMessage(data, `Meta Graph returned ${response.status}.`);
      logError('MetaPublish', `Facebook publish failed for brand "${brand}".`, { status: response.status, data });
      return { ok: false, errorCode: code, errorMessage: msg };
    }

    const postId = typeof data.id === 'string' ? data.id : undefined;
    logDebug('MetaPublish', `Facebook post published for brand "${brand}".`, { postId });
    return { ok: true, externalPostId: postId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error contacting Meta Graph API.';
    logError('MetaPublish', `Facebook publish threw for brand "${brand}".`, { error });
    return { ok: false, errorCode: 'NETWORK_ERROR', errorMessage: msg };
  }
}

// ── Instagram Business account post ─────────────────────────────────────────
// Instagram feed posts via the Graph API require an image (image_url or video).
// Text-only posts are NOT supported; callers must supply imageUrl.
// If imageUrl is omitted, this returns a clear CONFIG_MISSING error.

export async function publishToInstagram(
  brand: string,
  caption: string,
  imageUrls?: string[],
): Promise<PublishResult> {
  const config = await resolveInstagramConfigForBrand(brand);
  if (!config) {
    logError('MetaPublish', `Missing Instagram publish config for brand "${brand}". Add an Instagram account ID and token in Settings > Meta Channels.`);
    return {
      ok: false,
      errorCode: 'CONFIG_MISSING',
      errorMessage: `Instagram publish config not set for brand "${brand}". Configure Settings > Meta Channels.`,
    };
  }

  if (!imageUrls || imageUrls.length === 0) {
    return {
      ok: false,
      errorCode: 'IMAGE_REQUIRED',
      errorMessage: 'Instagram feed posts require an image. Link a creative or provide an image URL before publishing to Instagram.',
    };
  }

  // Step 1 — create media container
  const containerUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.accountId}/media`;

  try {
    let creationId: string | undefined;

    if (imageUrls.length === 1) {
      // Single image container
      const containerRes = await fetch(containerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrls[0],
          caption,
          access_token: config.accessToken,
        }),
      });

      const containerData = await containerRes.json() as MetaIdResponse;
      if (!containerRes.ok) {
        return {
          ok: false,
          errorCode: getMetaErrorCode(containerData, containerRes.status),
          errorMessage: getMetaErrorMessage(containerData, `Meta Graph returned ${containerRes.status} creating media.`),
        };
      }
      creationId = containerData.id;
    } else {
      // Carousel items
      const itemIds: string[] = [];
      for (const url of imageUrls) {
        const itemRes = await fetch(containerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: url,
            is_carousel_item: true,
            access_token: config.accessToken,
          }),
        });
        const itemData = await itemRes.json() as MetaIdResponse;
        if (itemRes.ok && itemData.id) {
          itemIds.push(itemData.id);
        } else {
          return {
            ok: false,
            errorCode: getMetaErrorCode(itemData, itemRes.status),
            errorMessage: getMetaErrorMessage(itemData, `Meta Graph returned ${itemRes.status} creating carousel item.`),
          };
        }
      }

      // Carousel container
      const carouselRes = await fetch(containerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: itemIds,
          caption,
          access_token: config.accessToken,
        }),
      });
      const carouselData = await carouselRes.json() as MetaIdResponse;
      if (!carouselRes.ok) {
        return {
          ok: false,
          errorCode: getMetaErrorCode(carouselData, carouselRes.status),
          errorMessage: getMetaErrorMessage(carouselData, `Meta Graph returned ${carouselRes.status} creating carousel.`),
        };
      }
      creationId = carouselData.id;
    }

    if (!creationId) {
      return { ok: false, errorCode: 'NO_CREATION_ID', errorMessage: 'Meta did not return a media creation ID.' };
    }

    // Step 2 — publish container
    const publishUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.accountId}/media_publish`;

    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId, access_token: config.accessToken }),
    });

    const publishData = await publishRes.json() as Record<string, unknown>;

    if (!publishRes.ok) {
      const code = getMetaErrorCode(publishData, publishRes.status);
      const msg = getMetaErrorMessage(publishData, `Meta Graph returned ${publishRes.status} publishing media.`);
      logError('MetaPublish', `Instagram media publish failed for brand "${brand}".`, { status: publishRes.status, data: publishData });
      return { ok: false, errorCode: code, errorMessage: msg };
    }

    const postId = typeof publishData.id === 'string' ? publishData.id : undefined;
    logDebug('MetaPublish', `Instagram post published for brand "${brand}".`, { postId });
    return { ok: true, externalPostId: postId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error contacting Meta Graph API.';
    logError('MetaPublish', `Instagram publish threw for brand "${brand}".`, { error });
    return { ok: false, errorCode: 'NETWORK_ERROR', errorMessage: msg };
  }
}
