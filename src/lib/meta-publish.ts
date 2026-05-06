import { logDebug, logError } from '@/lib/app-log';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

export interface PublishResult {
  ok: boolean;
  externalPostId?: string;
  errorCode?: string;
  errorMessage?: string;
}

// ── Brand-to-channel config resolution ──────────────────────────────────────
// Per-brand env vars override the generic fallback:
//   META_FB_PAGE_ID_{BRAND_KEY}    or  META_FB_PAGE_ID
//   META_FB_PAGE_TOKEN_{BRAND_KEY} or  META_PAGE_ACCESS_TOKEN
//   META_IG_ACCOUNT_ID_{BRAND_KEY} or  META_IG_ACCOUNT_ID
//   META_IG_TOKEN_{BRAND_KEY}      or  META_PAGE_ACCESS_TOKEN

function brandEnvKey(brand: string): string {
  return brand.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function resolveEnv(brandKey: string, suffix: string, fallback: string | undefined): string | undefined {
  return process.env[`${suffix}_${brandKey}`] ?? process.env[suffix] ?? fallback;
}

interface FbPublishConfig {
  pageId: string;
  token: string;
}

interface IgPublishConfig {
  accountId: string;
  token: string;
}

function resolveFbConfig(brand: string): FbPublishConfig | null {
  const bk = brandEnvKey(brand);
  const pageId = resolveEnv(bk, 'META_FB_PAGE_ID', undefined);
  const token = resolveEnv(bk, 'META_FB_PAGE_TOKEN', process.env.META_PAGE_ACCESS_TOKEN);
  if (!pageId || !token) return null;
  return { pageId, token };
}

function resolveIgConfig(brand: string): IgPublishConfig | null {
  const bk = brandEnvKey(brand);
  const accountId = resolveEnv(bk, 'META_IG_ACCOUNT_ID', undefined);
  const token = resolveEnv(bk, 'META_IG_TOKEN', process.env.META_PAGE_ACCESS_TOKEN);
  if (!accountId || !token) return null;
  return { accountId, token };
}

// ── Facebook Page post ───────────────────────────────────────────────────────

export async function publishToFacebook(brand: string, caption: string, imageUrls?: string[]): Promise<PublishResult> {
  const config = resolveFbConfig(brand);
  if (!config) {
    logError('MetaPublish', `Missing Facebook publish config for brand "${brand}". Set META_FB_PAGE_ID and META_FB_PAGE_TOKEN (or their brand-scoped variants).`);
    return {
      ok: false,
      errorCode: 'CONFIG_MISSING',
      errorMessage: `Facebook publish config not set for brand "${brand}". Configure META_FB_PAGE_ID and META_FB_PAGE_TOKEN.`,
    };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.pageId}/feed`;

  try {
    let attachedMedia: any[] = [];
    
    // Upload photos if any
    if (imageUrls && imageUrls.length > 0) {
      for (const url of imageUrls) {
        const photoRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${config.pageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, published: false, access_token: config.token }),
        });
        const photoData = await photoRes.json() as any;
        if (photoRes.ok && photoData.id) {
          attachedMedia.push({ media_fbid: photoData.id });
        } else {
          logError('MetaPublish', `Failed to upload FB photo for brand "${brand}"`, photoData);
        }
      }
    }

    const payload: any = { message: caption, access_token: config.token };
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
      const err = data.error as Record<string, unknown> | undefined;
      const code = err?.code != null ? String(err.code) : String(response.status);
      const msg = typeof err?.message === 'string' ? err.message : `Meta Graph returned ${response.status}.`;
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
  const config = resolveIgConfig(brand);
  if (!config) {
    logError('MetaPublish', `Missing Instagram publish config for brand "${brand}". Set META_IG_ACCOUNT_ID and META_IG_TOKEN.`);
    return {
      ok: false,
      errorCode: 'CONFIG_MISSING',
      errorMessage: `Instagram publish config not set for brand "${brand}". Configure META_IG_ACCOUNT_ID and META_IG_TOKEN.`,
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
          access_token: config.token,
        }),
      });

      const containerData = await containerRes.json() as any;
      if (!containerRes.ok) {
        return { ok: false, errorCode: containerData.error?.code, errorMessage: containerData.error?.message };
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
            access_token: config.token,
          }),
        });
        const itemData = await itemRes.json() as any;
        if (itemRes.ok && itemData.id) {
          itemIds.push(itemData.id);
        } else {
          return { ok: false, errorCode: itemData.error?.code, errorMessage: itemData.error?.message };
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
          access_token: config.token,
        }),
      });
      const carouselData = await carouselRes.json() as any;
      if (!carouselRes.ok) {
        return { ok: false, errorCode: carouselData.error?.code, errorMessage: carouselData.error?.message };
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
      body: JSON.stringify({ creation_id: creationId, access_token: config.token }),
    });

    const publishData = await publishRes.json() as Record<string, unknown>;

    if (!publishRes.ok) {
      const err = publishData.error as Record<string, unknown> | undefined;
      const code = err?.code != null ? String(err.code) : String(publishRes.status);
      const msg = typeof err?.message === 'string' ? err.message : `Meta Graph returned ${publishRes.status} publishing media.`;
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
