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

async function postMetaJson(url: string, payload: Record<string, unknown>): Promise<{ response: Response; data: MetaIdResponse }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json() as MetaIdResponse;
  return { response, data };
}

async function postMetaForm(url: string, params: Record<string, string>): Promise<{ response: Response; data: MetaIdResponse }> {
  const response = await fetch(url, {
    method: 'POST',
    body: new URLSearchParams(params),
  });
  const data = await response.json() as MetaIdResponse;
  return { response, data };
}

async function postInstagramGraph(
  path: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<{ response: Response; data: MetaIdResponse; host: string }> {
  const cleanedAccessToken = accessToken.replace(/\s+/g, '').trim();
  const tokenLooksLikeInstagramLogin = cleanedAccessToken.startsWith('IG');
  const instagramUrl = `https://graph.instagram.com/${META_GRAPH_VERSION}/${path}`;
  const facebookUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`;
  const instagramPayload = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, String(value)]),
  );
  const instagramResult = await postMetaForm(instagramUrl, {
    ...instagramPayload,
    access_token: cleanedAccessToken,
  });

  if (instagramResult.response.ok || tokenLooksLikeInstagramLogin) {
    if (!instagramResult.response.ok) {
      logError('MetaPublish', 'Instagram Graph publish call failed.', {
        host: 'graph.instagram.com',
        path,
        status: instagramResult.response.status,
        tokenPrefix: cleanedAccessToken.slice(0, 4),
        tokenLength: cleanedAccessToken.length,
        data: instagramResult.data,
      });
    }

    return { ...instagramResult, host: 'graph.instagram.com' };
  }

  const fallbackResult = await postMetaJson(facebookUrl, {
    ...payload,
    access_token: cleanedAccessToken,
  });

  if (!fallbackResult.response.ok) {
    logError('MetaPublish', 'Instagram Graph and Facebook Graph publish calls both failed.', {
      instagram: {
        status: instagramResult.response.status,
        data: instagramResult.data,
      },
      facebook: {
        status: fallbackResult.response.status,
        data: fallbackResult.data,
      },
    });
  }

  return { ...fallbackResult, host: 'graph.facebook.com' };
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

  try {
    let creationId: string | undefined;

    if (imageUrls.length === 1) {
      // Single image container
      const { response: containerRes, data: containerData } = await postInstagramGraph(`${config.accountId}/media`, config.accessToken, {
        image_url: imageUrls[0],
        caption,
      });
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
        const { response: itemRes, data: itemData } = await postInstagramGraph(`${config.accountId}/media`, config.accessToken, {
          image_url: url,
          is_carousel_item: true,
        });
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
      const { response: carouselRes, data: carouselData } = await postInstagramGraph(`${config.accountId}/media`, config.accessToken, {
        media_type: 'CAROUSEL',
        children: itemIds.join(','),
        caption,
      });
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
    const { response: publishRes, data: publishData, host: publishHost } = await postInstagramGraph(`${config.accountId}/media_publish`, config.accessToken, {
      creation_id: creationId,
    });

    if (!publishRes.ok) {
      const code = getMetaErrorCode(publishData, publishRes.status);
      const msg = getMetaErrorMessage(publishData, `Meta Graph returned ${publishRes.status} publishing media.`);
      logError('MetaPublish', `Instagram media publish failed for brand "${brand}".`, { status: publishRes.status, data: publishData });
      return { ok: false, errorCode: code, errorMessage: msg };
    }

    const postId = typeof publishData.id === 'string' ? publishData.id : undefined;
    logDebug('MetaPublish', `Instagram post published for brand "${brand}".`, { postId, host: publishHost });
    return { ok: true, externalPostId: postId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error contacting Meta Graph API.';
    logError('MetaPublish', `Instagram publish threw for brand "${brand}".`, { error });
    return { ok: false, errorCode: 'NETWORK_ERROR', errorMessage: msg };
  }
}
