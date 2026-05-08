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
  type ViewAngle,
} from '@/lib/creative-generator';
import {
  publishToFacebook,
  publishToInstagram,
  type PublishImageInput,
} from '@/lib/meta-publish';
import { getPublicAssetUrl } from '@/lib/runtime-config';
import { buildGarmentSpecsForAi } from '@/lib/product-garment-specs';

export interface SocialPostCreativeInput {
  creativeId: number;
  description?: string;
  displayOrder: number;
}

export interface SocialPostInput {
  brand: string;
  channels: string[]; // ['facebook'] | ['instagram'] | ['facebook','instagram']
  caption: string;
  generatedCaptions?: string[];
  productContext?: string;
  status: 'draft' | 'ready';
  postCreatives?: SocialPostCreativeInput[];
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
        postCreatives: input.postCreatives && input.postCreatives.length > 0 ? {
          create: input.postCreatives.map(pc => ({
            creativeId: pc.creativeId,
            description: pc.description,
            displayOrder: pc.displayOrder,
          }))
        } : undefined,
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

    if (input.postCreatives) {
      await prisma.socialPostCreative.deleteMany({
        where: { socialPostId: postId }
      });
      if (input.postCreatives.length > 0) {
        await prisma.socialPostCreative.createMany({
          data: input.postCreatives.map(pc => ({
            socialPostId: postId,
            creativeId: pc.creativeId,
            description: pc.description,
            displayOrder: pc.displayOrder,
          }))
        });
      }
    }

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

// ── Product Search ──────────────────────────────────────────────────────────

export async function searchProductsForContent(query: string, brand: string) {
  try {
    const scope = await requireActionPermission('content:view');
    assertBrandAccess(scope, brand);

    const products = await prisma.product.findMany({
      where: {
        brand,
        name: { contains: query, mode: 'insensitive' },
      },
      take: 10,
      select: {
        id: true,
        name: true,
        brand: true,
        style: true,
        price: true,
        fabric: true,
        colors: true,
        sizes: true,
        imageUrl: true,
        garmentLengthCm: true,
        sleeveLengthCm: true,
        sleeveType: true,
        fitType: true,
        neckline: true,
        closureDetails: true,
        hasSideSlit: true,
        sideSlitHeightCm: true,
        hemDetails: true,
        sleeveHemDetails: true,
        patternDetails: true,
        referenceModelHeightCm: true,
        wornLengthNote: true,
        aiFidelityNotes: true,
      },
    });
    return { success: true, products };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to search products.' };
  }
}

// ── Creative generation ──────────────────────────────────────────────────────

export interface GenerateCreativeParams {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  garmentFitNotes?: string;
  sourceImageUrl?: string;
  productId?: number;
  viewAngle?: ViewAngle;
}

export interface GenerateCreativeResult {
  success: boolean;
  imageData?: string;
  prompt?: string;
  creativeId?: number; // ID of the auto-saved draft record
  viewAngle?: ViewAngle;
  error?: string;
}

export interface GenerateCreativeBatchResult {
  success: boolean;
  results: GenerateCreativeResult[];
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

    const linkedProduct = params.productId
      ? await prisma.product.findUnique({
          where: { id: params.productId },
          select: {
            brand: true,
            garmentLengthCm: true,
            sleeveLengthCm: true,
            sleeveType: true,
            fitType: true,
            neckline: true,
            closureDetails: true,
            hasSideSlit: true,
            sideSlitHeightCm: true,
            hemDetails: true,
            sleeveHemDetails: true,
            patternDetails: true,
            referenceModelHeightCm: true,
            wornLengthNote: true,
            aiFidelityNotes: true,
          },
        })
      : null;
    if (linkedProduct) assertBrandAccess(scope, linkedProduct.brand);

    const manualFitNotes = params.garmentFitNotes?.trim() || '';
    const structuredSpecs =
      linkedProduct && !manualFitNotes.includes('Structured garment specs from product record')
        ? buildGarmentSpecsForAi(linkedProduct)
        : '';
    const combinedProductContext = [
      params.productContext?.trim(),
      structuredSpecs,
      manualFitNotes ? `Fit measurements: ${manualFitNotes}` : '',
    ].filter(Boolean).join(' ');

    const input: CreativeGenerationInput = {
      brand: params.brand,
      personaId: params.personaId,
      productContext: combinedProductContext,
      garmentFitNotes: params.garmentFitNotes,
      sourceImageBase64,
      sourceImageMimeType,
      viewAngle: params.viewAngle,
    };

    const result = await generateCreativeLib(input);

    // Save immediately as a draft so the client never needs to POST the image back.
    // The user confirms with saveGeneratedCreative(creativeId) — a tiny payload.
    const draft = await prisma.generatedCreative.create({
      data: {
        brand: params.brand.trim(),
        productId: params.productId ?? null,
        viewAngle: params.viewAngle ?? null,
        sourceImageUrl: params.sourceImageUrl || null,
        generatedImageData: result.imageData,
        prompt: result.prompt,
        personaStyle: params.personaId !== 'none' ? params.personaId : null,
        productContext: combinedProductContext || null,
        status: 'draft',
        createdBy: scope.email ?? null,
      },
    });

    return {
      success: true,
      imageData: result.imageData,
      prompt: result.prompt,
      creativeId: draft.id,
      viewAngle: params.viewAngle,
    };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    const msg = error instanceof Error ? error.message : 'Creative generation failed.';
    return { success: false, error: msg };
  }
}

// Batch variant — generates one creative per requested view angle, sequentially.
// Each generation is a separate Gemini call; failures on individual angles do not
// abort the whole batch.
export async function generateCreativeBatchAction(
  params: Omit<GenerateCreativeParams, 'viewAngle'> & { viewAngles: ViewAngle[] },
): Promise<GenerateCreativeBatchResult> {
  const angles = params.viewAngles.length > 0 ? params.viewAngles : (['front'] as ViewAngle[]);
  const results: GenerateCreativeResult[] = [];
  for (const angle of angles) {
    const r = await generateCreativeAction({ ...params, viewAngle: angle });
    results.push(r);
  }
  return { success: results.some(r => r.success), results };
}

// Regenerate a single existing draft with the same params + an optional user
// correction note ("e.g. no buttons on back"). Replaces the old draft in place
// so the UI tile updates without renumbering. The original creative must be in
// 'draft' status — saved creatives are immutable.
export async function regenerateCreativeAction(
  creativeId: number,
  correctionText?: string,
): Promise<GenerateCreativeResult> {
  try {
    const scope = await requireActionPermission('content:write');

    const original = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: {
        brand: true, status: true, productId: true, viewAngle: true,
        sourceImageUrl: true, personaStyle: true, productContext: true,
      },
    });
    if (!original) return { success: false, error: 'Creative not found.' };
    if (original.status !== 'draft') {
      return { success: false, error: 'Only draft creatives can be regenerated.' };
    }
    assertBrandAccess(scope, original.brand);

    let sourceImageBase64: string | undefined;
    let sourceImageMimeType: string | undefined;
    if (original.sourceImageUrl) {
      const res = await fetch(original.sourceImageUrl);
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

    const linkedProduct = original.productId
      ? await prisma.product.findUnique({
          where: { id: original.productId },
          select: {
            brand: true,
            garmentLengthCm: true,
            sleeveLengthCm: true,
            sleeveType: true,
            fitType: true,
            neckline: true,
            closureDetails: true,
            hasSideSlit: true,
            sideSlitHeightCm: true,
            hemDetails: true,
            sleeveHemDetails: true,
            patternDetails: true,
            referenceModelHeightCm: true,
            wornLengthNote: true,
            aiFidelityNotes: true,
          },
        })
      : null;
    const originalProductContext = original.productContext ?? '';
    const structuredSpecs =
      linkedProduct && !originalProductContext.includes('Structured garment specs from product record')
        ? buildGarmentSpecsForAi(linkedProduct)
        : '';
    const regeneratedProductContext = [
      originalProductContext,
      structuredSpecs,
    ].filter(Boolean).join('\n\n');

    const result = await generateCreativeLib({
      brand: original.brand,
      personaId: (original.personaStyle ?? 'none') as PersonaId,
      productContext: regeneratedProductContext,
      sourceImageBase64,
      sourceImageMimeType,
      viewAngle: (original.viewAngle ?? undefined) as ViewAngle | undefined,
      correctionText,
    });

    // Replace in place — keep the same id so the UI tile slot stays consistent.
    await prisma.generatedCreative.update({
      where: { id: creativeId },
      data: {
        generatedImageData: result.imageData,
        prompt: result.prompt,
      },
    });

    return {
      success: true,
      imageData: result.imageData,
      prompt: result.prompt,
      creativeId,
      viewAngle: (original.viewAngle ?? undefined) as ViewAngle | undefined,
    };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    const msg = error instanceof Error ? error.message : 'Regeneration failed.';
    return { success: false, error: msg };
  }
}

// Fetch saved generations for a product so the user can reuse them instead of
// regenerating. Returns metadata only — image bytes are streamed via the
// /api/content/creatives/[id]/image route.
export async function getCreativesForProduct(productId: number) {
  try {
    const scope = await requireActionPermission('content:view');

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { brand: true },
    });
    if (!product) return { success: false, error: 'Product not found.' };
    assertBrandAccess(scope, product.brand);

    const creatives = await prisma.generatedCreative.findMany({
      where: { productId, status: 'saved' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        viewAngle: true,
        personaStyle: true,
        createdAt: true,
      },
    });
    return { success: true, creatives };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to load creatives.' };
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

function cleanDetailValue(value?: string | null): string {
  const cleaned = value?.trim();
  return cleaned || 'N/A';
}

function formatRsPrice(price?: number | null): string {
  return typeof price === 'number' && Number.isFinite(price)
    ? `Rs ${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : 'N/A';
}

function parseProductContextValue(context: string | null | undefined, label: string): string | null {
  if (!context) return null;
  const match = context.match(new RegExp(`${label}:\\s*([^.]+)`, 'i'));
  return match?.[1]?.trim() || null;
}

function buildItemDescription(input: {
  fallbackDescription?: string | null;
  productContext?: string | null;
  product?: {
    id: number;
    name: string;
    price: number;
    sizes: string;
    colors: string;
    variants: Array<{ sku: string | null }>;
  } | null;
}): string {
  const product = input.product;
  const itemName = product?.name ?? parseProductContextValue(input.productContext, 'Name');
  const itemCode = product?.variants
    .map((variant) => variant.sku?.trim())
    .find((sku): sku is string => Boolean(sku))
    ?? (product ? `#${product.id}` : null);
  const sizes = product?.sizes ?? parseProductContextValue(input.productContext, 'Sizes');
  const colors = product?.colors ?? parseProductContextValue(input.productContext, 'Colors');
  const price = product
    ? formatRsPrice(product.price)
    : cleanDetailValue(parseProductContextValue(input.productContext, 'Price'));

  if (!itemName && !itemCode && !sizes && !colors && price === 'N/A') {
    return cleanDetailValue(input.fallbackDescription);
  }

  return [
    `Item Name: ${cleanDetailValue(itemName)}`,
    `Item Code: ${cleanDetailValue(itemCode)}`,
    `Available Sizes: ${cleanDetailValue(sizes)}`,
    `Available Colors: ${cleanDetailValue(colors)}`,
    `Item Price: ${price}`,
  ].join('\n');
}

function appendItemDescriptions(caption: string, descriptions: string[]): string {
  const cleanCaption = caption.trim();
  if (cleanCaption.includes('Item Name:')) {
    return cleanCaption;
  }

  const uniqueDescriptions = Array.from(
    new Set(descriptions.map((description) => description.trim()).filter(Boolean)),
  );

  if (uniqueDescriptions.length === 0) {
    return cleanCaption;
  }

  return `${cleanCaption}\n\n${uniqueDescriptions.join('\n\n')}`;
}

export async function publishSocialPost(
  postId: number,
  baseUrl?: string,
): Promise<PublishSocialPostResult> {
  try {
    const scope = await requireActionPermission('content:write');

    const post = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: {
        id: true,
        brand: true,
        channels: true,
        caption: true,
        status: true,
        postCreatives: {
          select: {
            creativeId: true,
            description: true,
            creative: {
              select: {
                productContext: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    price: true,
                    sizes: true,
                    colors: true,
                    variants: {
                      select: { sku: true },
                      orderBy: { id: 'asc' },
                    },
                  },
                },
              },
            },
          },
          orderBy: { displayOrder: 'asc' },
        },
      },
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

    const fallbackBaseUrl = baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')
      ? baseUrl.replace(/\/$/, '')
      : null;
    const imageInputs: PublishImageInput[] | undefined = post.postCreatives.length > 0
      ? post.postCreatives
        .flatMap((pc): PublishImageInput[] => {
          const path = `/api/content/creatives/${pc.creativeId}/image`;
          const url = getPublicAssetUrl(path) ?? (fallbackBaseUrl ? `${fallbackBaseUrl}${path}` : null);
          if (!url) return [];

          return [{
            url,
            description: buildItemDescription({
              fallbackDescription: pc.description,
              productContext: pc.creative?.productContext,
              product: pc.creative?.product,
            }),
          }];
        })
      : undefined;
    const imageUrls = imageInputs?.map((image) => image.url);
    const publishCaption = appendItemDescriptions(
      post.caption,
      imageInputs?.map((image) => image.description ?? '') ?? [],
    );

    for (const channel of channels) {
      let result;
      if (channel === 'facebook') {
        result = await publishToFacebook(post.brand, publishCaption, imageInputs);
      } else if (channel === 'instagram') {
        result = await publishToInstagram(post.brand, publishCaption, imageUrls);
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
