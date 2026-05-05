'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import {
  accessDeniedResult,
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import { generateCaptions, type CaptionGenerationInput } from '@/lib/caption-generator';
import {
  generateCreative as generateCreativeLib,
  type CreativeGenerationInput,
  type PersonaId,
} from '@/lib/creative-generator';
import { publishToFacebook, publishToInstagram } from '@/lib/meta-publish';

export interface SocialPostInput {
  brand: string;
  channels: string[]; // ['facebook'] | ['instagram'] | ['facebook','instagram']
  caption: string;
  generatedCaptions?: string[];
  productContext?: string;
  status: 'draft' | 'ready';
}

export interface SocialPostResult {
  success: boolean;
  error?: string;
  postId?: number;
}

export interface GenerateCaptionsResult {
  success: boolean;
  captions?: string[];
  error?: string;
}

export async function createSocialPost(input: SocialPostInput): Promise<SocialPostResult> {
  try {
    const scope = await requireActionPermission('content:write');
    assertBrandAccess(scope, input.brand);

    if (!input.caption.trim()) {
      return { success: false, error: 'Caption cannot be empty.' };
    }
    if (input.channels.length === 0) {
      return { success: false, error: 'Select at least one channel.' };
    }

    const post = await prisma.socialPost.create({
      data: {
        brand: input.brand.trim(),
        channels: input.channels.join(','),
        caption: input.caption.trim(),
        generatedCaptions: input.generatedCaptions
          ? JSON.stringify(input.generatedCaptions)
          : null,
        productContext: input.productContext?.trim() || null,
        status: input.status,
        createdBy: scope.email ?? null,
      },
    });

    revalidatePath('/content');
    return { success: true, postId: post.id };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to save draft. Please retry.' };
  }
}

export async function updateSocialPost(
  postId: number,
  input: SocialPostInput,
): Promise<SocialPostResult> {
  try {
    const scope = await requireActionPermission('content:write');
    assertBrandAccess(scope, input.brand);

    const existing = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: { brand: true },
    });
    if (!existing) return { success: false, error: 'Post not found.' };
    assertBrandAccess(scope, existing.brand);

    if (!input.caption.trim()) {
      return { success: false, error: 'Caption cannot be empty.' };
    }
    if (input.channels.length === 0) {
      return { success: false, error: 'Select at least one channel.' };
    }

    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        brand: input.brand.trim(),
        channels: input.channels.join(','),
        caption: input.caption.trim(),
        generatedCaptions: input.generatedCaptions
          ? JSON.stringify(input.generatedCaptions)
          : null,
        productContext: input.productContext?.trim() || null,
        status: input.status,
      },
    });

    revalidatePath('/content');
    return { success: true, postId };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to update draft. Please retry.' };
  }
}

export async function generatePostCaptions(
  params: CaptionGenerationInput,
): Promise<GenerateCaptionsResult> {
  try {
    const scope = await requireActionPermission('content:view');
    assertBrandAccess(scope, params.brand);

    const captions = await generateCaptions(params);
    return { success: true, captions };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Caption generation failed. Please retry.' };
  }
}

// ── Creative generation ──────────────────────────────────────────────────────

export interface GenerateCreativeParams {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  sourceImageUrl?: string;
}

export interface GenerateCreativeResult {
  success: boolean;
  imageData?: string;
  prompt?: string;
  creativeId?: number; // ID of the auto-saved draft record
  error?: string;
}

export async function generateCreativeAction(
  params: GenerateCreativeParams,
): Promise<GenerateCreativeResult> {
  try {
    const scope = await requireActionPermission('content:write');
    assertBrandAccess(scope, params.brand);

    let sourceImageBase64: string | undefined;
    let sourceImageMimeType: string | undefined;

    if (params.sourceImageUrl) {
      const res = await fetch(params.sourceImageUrl);
      if (!res.ok) throw new Error(`Failed to fetch source image: ${res.status}`);
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();
      if (!mimeType.startsWith('image/')) {
        throw new Error('Source URL does not point to an image.');
      }
      const buffer = await res.arrayBuffer();
      sourceImageBase64 = Buffer.from(buffer).toString('base64');
      sourceImageMimeType = mimeType;
    }

    const input: CreativeGenerationInput = {
      brand: params.brand,
      personaId: params.personaId,
      productContext: params.productContext,
      sourceImageBase64,
      sourceImageMimeType,
    };

    const result = await generateCreativeLib(input);

    // Save immediately as a draft so the client never needs to POST the image back.
    // The user confirms with saveGeneratedCreative(creativeId) — a tiny payload.
    const draft = await prisma.generatedCreative.create({
      data: {
        brand: params.brand.trim(),
        sourceImageUrl: params.sourceImageUrl || null,
        generatedImageData: result.imageData,
        prompt: result.prompt,
        personaStyle: params.personaId !== 'none' ? params.personaId : null,
        productContext: params.productContext?.trim() || null,
        status: 'draft',
        createdBy: scope.email ?? null,
      },
    });

    return { success: true, imageData: result.imageData, prompt: result.prompt, creativeId: draft.id };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    const msg = error instanceof Error ? error.message : 'Creative generation failed.';
    return { success: false, error: msg };
  }
}

export interface SaveCreativeResult {
  success: boolean;
  creativeId?: number;
  error?: string;
}

// Confirm a previously auto-saved draft — flips status to 'saved'.
// The image is already in the DB from generateCreativeAction; no large payload needed.
export async function saveGeneratedCreative(creativeId: number): Promise<SaveCreativeResult> {
  try {
    const scope = await requireActionPermission('content:write');

    const existing = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: { brand: true, status: true },
    });
    if (!existing) return { success: false, error: 'Creative not found.' };
    assertBrandAccess(scope, existing.brand);

    await prisma.generatedCreative.update({
      where: { id: creativeId },
      data: { status: 'saved' },
    });

    revalidatePath('/content');
    return { success: true, creativeId };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to save creative. Please retry.' };
  }
}

// Delete an unsaved draft — called on Regenerate or modal close without saving.
export async function discardCreativeDraft(creativeId: number): Promise<{ success: boolean }> {
  try {
    const scope = await requireActionPermission('content:write');

    const existing = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: { brand: true, status: true },
    });
    // Only delete drafts; saved creatives are kept
    if (!existing || existing.status !== 'draft') return { success: true };
    assertBrandAccess(scope, existing.brand);

    await prisma.generatedCreative.delete({ where: { id: creativeId } });
    return { success: true };
  } catch {
    return { success: false };
  }
}

// Permanently delete a saved creative.
export async function deleteGeneratedCreative(creativeId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const scope = await requireActionPermission('content:write');

    const existing = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: { brand: true },
    });
    if (!existing) return { success: false, error: 'Creative not found.' };
    assertBrandAccess(scope, existing.brand);

    await prisma.generatedCreative.delete({ where: { id: creativeId } });
    revalidatePath('/content');
    return { success: true };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to delete creative.' };
  }
}

// ── Publishing ───────────────────────────────────────────────────────────────

export interface ChannelPublishOutcome {
  channel: string;
  ok: boolean;
  externalPostId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface PublishSocialPostResult {
  success: boolean;
  error?: string;
  outcomes?: ChannelPublishOutcome[];
  publishStatus?: string;
}

export async function publishSocialPost(
  postId: number,
  imageUrl?: string,
): Promise<PublishSocialPostResult> {
  try {
    const scope = await requireActionPermission('content:write');

    const post = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: { id: true, brand: true, channels: true, caption: true, status: true },
    });

    if (!post) return { success: false, error: 'Post not found.' };
    assertBrandAccess(scope, post.brand);

    if (post.status !== 'ready') {
      return {
        success: false,
        error: 'Only posts with status "Ready to Publish" can be published. Update the draft status first.',
      };
    }

    const channels = post.channels.split(',').map((c) => c.trim()).filter(Boolean);
    if (channels.length === 0) {
      return { success: false, error: 'Post has no channels configured.' };
    }

    const outcomes: ChannelPublishOutcome[] = [];

    for (const channel of channels) {
      let result;
      if (channel === 'facebook') {
        result = await publishToFacebook(post.brand, post.caption);
      } else if (channel === 'instagram') {
        result = await publishToInstagram(post.brand, post.caption, imageUrl);
      } else {
        outcomes.push({
          channel,
          ok: false,
          errorCode: 'UNSUPPORTED_CHANNEL',
          errorMessage: `Channel "${channel}" is not supported for publishing.`,
        });
        continue;
      }

      outcomes.push({
        channel,
        ok: result.ok,
        externalPostId: result.externalPostId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }

    // Persist log entries
    await prisma.socialPostPublishLog.createMany({
      data: outcomes.map((o) => ({
        socialPostId: post.id,
        channel: o.channel,
        brand: post.brand,
        status: o.ok ? 'published' : 'failed',
        externalPostId: o.externalPostId ?? null,
        errorCode: o.errorCode ?? null,
        errorMessage: o.errorMessage ?? null,
        publishedBy: scope.email ?? null,
      })),
    });

    const allOk = outcomes.every((o) => o.ok);
    const anyOk = outcomes.some((o) => o.ok);
    const publishStatus = allOk ? 'published' : anyOk ? 'partial' : 'failed';

    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        publishStatus,
        publishedAt: new Date(),
        publishedBy: scope.email ?? null,
      },
    });

    revalidatePath('/content');

    return {
      success: allOk || anyOk,
      outcomes,
      publishStatus,
      error: allOk ? undefined : 'Some channels failed to publish. See details below.',
    };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error) as PublishSocialPostResult;
    return { success: false, error: 'Publish failed. Please retry.' };
  }
}
