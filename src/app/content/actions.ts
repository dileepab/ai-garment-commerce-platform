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
