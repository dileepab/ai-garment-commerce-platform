import {
  getTikTokPostSettings,
  getTikTokPublishStatus,
  publishTikTokPhoto,
  TikTokAccountApiError,
  type TikTokPublishStatusResult,
} from '@/lib/tiktok-account-api';
import { resolveTikTokAccountConnection } from '@/lib/tiktok-account-connection';
import { tiktokCreativeImagePath } from '@/lib/creative-image-token';
import { getPublicAssetUrl } from '@/lib/runtime-config';

export type TikTokPhotoOutcomeStatus = 'published' | 'processing' | 'failed';

export interface TikTokPhotoPublishOutcome {
  ok: boolean;
  status: TikTokPhotoOutcomeStatus;
  externalPostId?: string;
  errorCode?: string;
  errorMessage?: string;
}

function errorOutcome(error: unknown): TikTokPhotoPublishOutcome {
  if (error instanceof TikTokAccountApiError) {
    return {
      ok: false,
      status: 'failed',
      errorCode: error.code === null ? 'TIKTOK_API_ERROR' : `TIKTOK_API_${error.code}`,
      errorMessage: error.message,
    };
  }
  return {
    ok: false,
    status: 'failed',
    errorCode: 'TIKTOK_PUBLISH_ERROR',
    errorMessage: error instanceof Error ? error.message : 'TikTok photo publishing failed.',
  };
}

function outcomeFromStatus(
  status: TikTokPublishStatusResult,
  publishId: string,
): TikTokPhotoPublishOutcome {
  if (status.status === 'PUBLISH_COMPLETE') {
    return {
      ok: true,
      status: 'published',
      externalPostId: status.postIds[0] ?? publishId,
    };
  }
  if (status.status === 'FAILED') {
    return {
      ok: false,
      status: 'failed',
      externalPostId: publishId,
      errorCode: 'TIKTOK_PUBLISH_FAILED',
      errorMessage: status.reason
        ? `TikTok could not publish this post (${status.reason}).`
        : 'TikTok could not publish this post.',
    };
  }
  if (status.status === 'SEND_TO_USER_INBOX') {
    return {
      ok: false,
      status: 'failed',
      externalPostId: publishId,
      errorCode: 'TIKTOK_UNEXPECTED_DRAFT',
      errorMessage: 'TikTok sent this post to the account inbox instead of publishing it.',
    };
  }
  return { ok: true, status: 'processing', externalPostId: publishId };
}

async function resolveConnection(brand: string) {
  const connection = await resolveTikTokAccountConnection(brand);
  if (!connection) {
    throw new Error(`Connect the ${brand} TikTok Business Account in Settings before publishing.`);
  }
  return connection;
}

export async function publishPhotoPostToTikTok(input: {
  brand: string;
  caption: string;
  creativeIds: number[];
}): Promise<TikTokPhotoPublishOutcome> {
  if (input.creativeIds.length === 0) {
    return {
      ok: false,
      status: 'failed',
      errorCode: 'TIKTOK_PHOTO_REQUIRED',
      errorMessage: 'TikTok photo posts require at least one campaign image.',
    };
  }

  try {
    const connection = await resolveConnection(input.brand);
    const imageUrls = input.creativeIds.map((creativeId) => {
      const imagePath = tiktokCreativeImagePath(creativeId);
      if (!imagePath) {
        throw new Error('CREATIVE_IMAGE_SECRET or AUTH_SECRET must be configured before publishing to TikTok.');
      }
      const imageUrl = getPublicAssetUrl(imagePath);
      if (!imageUrl) {
        throw new Error('APP_BASE_URL must be configured before publishing to TikTok.');
      }
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost') {
        throw new Error('TikTok media must use the production HTTPS app URL.');
      }
      return parsed.toString();
    });

    // TikTok requires callers to use the account's current privacy/comment
    // settings. Refuse to guess, because a hard-coded value can publish more
    // broadly than the account holder intended.
    const settings = await getTikTokPostSettings({
      accessToken: connection.accessToken,
      businessId: connection.openId,
    });
    if (!settings.privacyLevelOptions.includes('PUBLIC_TO_EVERYONE')) {
      return {
        ok: false,
        status: 'failed',
        errorCode: 'TIKTOK_PUBLIC_POST_UNAVAILABLE',
        errorMessage: 'This TikTok account does not currently allow public API posts.',
      };
    }

    const submitted = await publishTikTokPhoto({
      accessToken: connection.accessToken,
      businessId: connection.openId,
      imageUrls,
      caption: input.caption,
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      disableComment: settings.commentDisabled,
      isBrandOrganic: true,
      isBrandedContent: false,
      autoAddMusic: false,
    });

    // Photo publishing is asynchronous. One immediate check catches fast
    // validation failures; Content Studio retains the share ID and offers a
    // later status refresh when TikTok is still downloading the images.
    try {
      const status = await getTikTokPublishStatus({
        accessToken: connection.accessToken,
        businessId: connection.openId,
        publishId: submitted.shareId,
      });
      return outcomeFromStatus(status, submitted.shareId);
    } catch (error) {
      console.error('[TikTok Publish] Accepted post but status lookup failed:', error);
      return { ok: true, status: 'processing', externalPostId: submitted.shareId };
    }
  } catch (error) {
    return errorOutcome(error);
  }
}

export async function refreshTikTokPhotoPostStatus(input: {
  brand: string;
  publishId: string;
}): Promise<TikTokPhotoPublishOutcome> {
  try {
    const connection = await resolveConnection(input.brand);
    const status = await getTikTokPublishStatus({
      accessToken: connection.accessToken,
      businessId: connection.openId,
      publishId: input.publishId,
    });
    return outcomeFromStatus(status, input.publishId);
  } catch (error) {
    return errorOutcome(error);
  }
}
