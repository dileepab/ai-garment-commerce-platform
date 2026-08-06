'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import {
  accessDeniedResult,
  assertBrandAccess,
  isAuthorizationError,
  requireActionPermission,
} from '@/lib/authz';
import {
  generateCaptions,
  generateCaptionsByChannel,
  type CaptionGenerationInput,
} from '@/lib/caption-generator';
import {
  generateCreative as generateCreativeLib,
  DEFAULT_ASPECT_RATIO,
  type CreativeAspectRatio,
  type CreativeGenerationInput,
  type CreativeGenerationQuality,
  type PersonaId,
  type ReferenceImage,
  type ViewAngle,
} from '@/lib/creative-generator';
import {
  publishToFacebook,
  publishToInstagram,
  type PublishImageInput,
} from '@/lib/meta-publish';
import { getPublicAssetUrl } from '@/lib/runtime-config';
import { creativeImagePath } from '@/lib/creative-image-token';
import { buildGarmentSpecsForAi } from '@/lib/product-garment-specs';
import { displayProductSku } from '@/lib/product-sku';
import { brandsMatch } from '@/lib/brand-aliases';

export interface SocialPostCreativeInput {
  creativeId: number;
  description?: string;
  displayOrder: number;
}

export interface SocialPostInput {
  brand: string;
  channels: string[]; // ['facebook'] | ['instagram'] | ['facebook','instagram']
  caption: string;
  // Optional per-channel overrides. Anything omitted falls back to `caption`.
  captionsByChannel?: Record<string, string>;
  generatedCaptions?: string[];
  productContext?: string;
  status: 'draft' | 'ready';
  postCreatives?: SocialPostCreativeInput[];
}

// Drops blank entries so an untouched channel box falls back to the shared
// caption instead of publishing an empty string.
function serializeCaptionsByChannel(
  captions: Record<string, string> | undefined,
): string | null {
  const entries = Object.entries(captions ?? {})
    .map(([channel, text]) => [channel, text?.trim() ?? ''] as const)
    .filter(([, text]) => text.length > 0);
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : null;
}

function parseCaptionsByChannel(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [channel, text] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof text === 'string' && text.trim()) result[channel] = text.trim();
    }
    return result;
  } catch {
    return {};
  }
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

export interface GenerateChannelCaptionsResult {
  success: boolean;
  captionsByChannel?: Record<string, string[]>;
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
        captionsByChannel: serializeCaptionsByChannel(input.captionsByChannel),
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
        // Omitting the field entirely leaves existing per-channel copy alone —
        // an editor that does not know about it must not silently erase it.
        ...(input.captionsByChannel !== undefined
          ? { captionsByChannel: serializeCaptionsByChannel(input.captionsByChannel) }
          : {}),
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

// Writes distinct copy for each channel in a single model call, so Instagram
// gets hashtags and Facebook gets the longer conversational version.
export async function generateChannelCaptions(
  params: CaptionGenerationInput,
): Promise<GenerateChannelCaptionsResult> {
  try {
    const scope = await requireActionPermission('content:view');
    assertBrandAccess(scope, params.brand);

    const captionsByChannel = await generateCaptionsByChannel(params);
    return { success: true, captionsByChannel };
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
        sku: true,
        name: true,
        brand: true,
        style: true,
        price: true,
        fabric: true,
        colors: true,
        sizes: true,
        imageUrl: true,
        colorImages: {
          orderBy: [{ color: 'asc' }, { angle: 'asc' }],
          select: {
            id: true,
            color: true,
            angle: true,
            imageUrl: true,
          },
        },
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

// ── Reference image upload ───────────────────────────────────────────────────

const MAX_REFERENCE_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface UploadReferenceResult {
  success: boolean;
  url?: string;
  error?: string;
}

// Uploads a garment photo for use as a generation reference. Mirrors
// uploadProductImage but is gated on content permissions, so a content editor
// can supply a back/side shot without write access to the product catalogue.
export async function uploadCreativeReference(formData: FormData): Promise<UploadReferenceResult> {
  try {
    await requireActionPermission('content:write');

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return { success: false, error: 'No file provided.' };
    }
    if (!file.type.startsWith('image/')) {
      return { success: false, error: 'Only image files are allowed.' };
    }
    if (file.size > MAX_REFERENCE_UPLOAD_BYTES) {
      return { success: false, error: 'Image exceeds the 5 MB limit after compression.' };
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return { success: false, error: 'BLOB_READ_WRITE_TOKEN is not configured.' };
    }

    const { put } = await import('@vercel/blob');
    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const key = `creative-references/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const blob = await put(key, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    });

    return { success: true, url: blob.url };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    const msg = error instanceof Error ? error.message : 'Upload failed.';
    return { success: false, error: msg };
  }
}

// ── Generated image storage ──────────────────────────────────────────────────

// Generated creatives used to live in Postgres as base64 data URLs, ~1-3 MB a
// row. Upload the bytes to blob storage and keep only the URL. Returns null
// when blob is not configured so callers fall back to the old column rather
// than losing the image.
async function uploadGeneratedImage(
  dataUrl: string,
  brand: string,
): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  const match = dataUrl.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!match) return null;

  try {
    const [, mimeType, base64] = match;
    const ext = (mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const slug = brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'brand';
    const key = `creatives/${slug}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { put } = await import('@vercel/blob');
    const blob = await put(key, Buffer.from(base64, 'base64'), {
      access: 'public',
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return blob.url;
  } catch (error) {
    console.error('[uploadGeneratedImage] falling back to inline storage:', error);
    return null;
  }
}

// Best-effort cleanup so deleting a creative does not leave the bytes behind.
async function deleteGeneratedImage(imageUrl: string | null): Promise<void> {
  if (!imageUrl || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { del } = await import('@vercel/blob');
    await del(imageUrl);
  } catch (error) {
    console.error('[deleteGeneratedImage] blob cleanup failed:', error);
  }
}

// ── Creative generation ──────────────────────────────────────────────────────

// One photograph of the garment, tagged with the angle it was shot from.
export interface ReferenceImageInput {
  url: string;
  angle: ViewAngle;
}

export interface GenerateCreativeParams {
  brand: string;
  personaId: PersonaId;
  productContext: string;
  garmentFitNotes?: string;
  // Preferred input: every angle photographed for this colour. The generator
  // uses the one matching viewAngle as the primary reference and the rest as
  // supporting context, so a back shot is reproduced instead of invented.
  referenceImages?: ReferenceImageInput[];
  sourceImageUrl?: string;
  sourceColor?: string;
  productId?: number;
  viewAngle?: ViewAngle;
  quality?: CreativeGenerationQuality;
  aspectRatio?: CreativeAspectRatio;
}

const MAX_REFERENCE_IMAGES = 4;

// Fetches a reference photo and inlines it for the image model.
async function fetchReferenceImage(url: string, angle: ViewAngle): Promise<ReferenceImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${angle} reference image: ${res.status}`);
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const mimeType = contentType.split(';')[0].trim();
  if (!mimeType.startsWith('image/')) {
    throw new Error(`The ${angle} reference URL does not point to an image.`);
  }
  const buffer = await res.arrayBuffer();
  return { base64: Buffer.from(buffer).toString('base64'), mimeType, angle };
}

// Collapses the legacy single-URL field and the per-angle list into one set,
// keeping the first photo supplied for each angle.
function collectReferenceInputs(params: {
  referenceImages?: ReferenceImageInput[];
  sourceImageUrl?: string;
}): ReferenceImageInput[] {
  const byAngle = new Map<ViewAngle, ReferenceImageInput>();

  for (const ref of params.referenceImages ?? []) {
    const url = ref.url?.trim();
    if (!url || byAngle.has(ref.angle)) continue;
    byAngle.set(ref.angle, { url, angle: ref.angle });
  }
  const legacyUrl = params.sourceImageUrl?.trim();
  if (legacyUrl && !byAngle.has('front')) {
    byAngle.set('front', { url: legacyUrl, angle: 'front' });
  }

  return [...byAngle.values()].slice(0, MAX_REFERENCE_IMAGES);
}

function parseStoredReferences(raw: string | null): ReferenceImageInput[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): ReferenceImageInput[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { url, angle } = entry as { url?: unknown; angle?: unknown };
      if (typeof url !== 'string' || !url.trim()) return [];
      const resolved = typeof angle === 'string' ? angle : 'front';
      return [{ url: url.trim(), angle: resolved as ViewAngle }];
    });
  } catch {
    return [];
  }
}

function parseStoredCorrections(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((note): note is string => typeof note === 'string' && note.trim().length > 0);
  } catch {
    return [];
  }
}

export interface GenerateCreativeResult {
  success: boolean;
  imageData?: string;
  prompt?: string;
  creativeId?: number; // ID of the auto-saved draft record
  viewAngle?: ViewAngle;
  sourceColor?: string;
  // True when the requested angle had its own photo rather than being inferred.
  grounded?: boolean;
  // Every correction applied so far, oldest first.
  corrections?: string[];
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

    const referenceInputs = collectReferenceInputs(params);
    const referenceImages = await Promise.all(
      referenceInputs.map(ref => fetchReferenceImage(ref.url, ref.angle)),
    );

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
      params.sourceColor?.trim() ? `Selected colour variant: ${params.sourceColor.trim()}. Use the source image for this exact colour.` : '',
      structuredSpecs,
      manualFitNotes ? `Fit measurements: ${manualFitNotes}` : '',
    ].filter(Boolean).join(' ');

    const aspectRatio = params.aspectRatio ?? DEFAULT_ASPECT_RATIO;
    const input: CreativeGenerationInput = {
      brand: params.brand,
      personaId: params.personaId,
      productContext: combinedProductContext,
      garmentFitNotes: params.garmentFitNotes,
      referenceImages,
      viewAngle: params.viewAngle,
      quality: params.quality,
      aspectRatio,
    };

    const result = await generateCreativeLib(input);

    // Save immediately as a draft so the client never needs to POST the image back.
    // The user confirms with saveGeneratedCreative(creativeId) — a tiny payload.
    // The full reference set is recorded so regenerate reproduces these inputs.
    const blobUrl = await uploadGeneratedImage(result.imageData, params.brand);
    const draft = await prisma.generatedCreative.create({
      data: {
        brand: params.brand.trim(),
        productId: params.productId ?? null,
        viewAngle: params.viewAngle ?? null,
        sourceImageUrl: referenceInputs[0]?.url ?? null,
        referenceImages: referenceInputs.length > 0 ? JSON.stringify(referenceInputs) : null,
        aspectRatio,
        imageUrl: blobUrl,
        // Only keep the bytes inline when blob storage is unavailable.
        generatedImageData: blobUrl ? null : result.imageData,
        prompt: result.prompt,
        personaStyle: params.personaId !== 'none' ? params.personaId : null,
        productContext: combinedProductContext || null,
        status: 'draft',
        createdBy: scope.email ?? null,
      },
    });

    return {
      success: true,
      // Prefer the blob URL so the browser loads from the CDN instead of
      // carrying a multi-megabyte data URL through the server action payload.
      imageData: blobUrl ?? result.imageData,
      prompt: result.prompt,
      creativeId: draft.id,
      viewAngle: params.viewAngle,
      sourceColor: params.sourceColor,
      grounded: result.grounded,
      corrections: [],
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
export interface BatchSourceImage {
  // Every angle photographed for this colour. All of them are handed to the
  // model on each generation; the requested angle becomes the primary reference.
  referenceImages?: ReferenceImageInput[];
  imageUrl?: string;
  color?: string;
  viewAngles?: ViewAngle[];
}

export async function generateCreativeBatchAction(
  params: Omit<GenerateCreativeParams, 'viewAngle' | 'sourceImageUrl' | 'sourceColor' | 'referenceImages'> & {
    viewAngles: ViewAngle[];
    sourceImageUrl?: string;
    referenceImages?: ReferenceImageInput[];
    sourceImages?: BatchSourceImage[];
  },
): Promise<GenerateCreativeBatchResult> {
  const angles = params.viewAngles.length > 0 ? params.viewAngles : (['front'] as ViewAngle[]);
  const sourceImages: BatchSourceImage[] =
    params.sourceImages && params.sourceImages.length > 0
      ? params.sourceImages
      : [{
          imageUrl: params.sourceImageUrl,
          referenceImages: params.referenceImages,
          color: undefined,
        }];

  // Flatten to one job per (colour, angle) so the Gemini calls can overlap.
  const jobs = sourceImages.flatMap((sourceImage) => {
    const sourceAngles = sourceImage.viewAngles && sourceImage.viewAngles.length > 0
      ? sourceImage.viewAngles
      : angles;
    return sourceAngles.map((angle) => ({ sourceImage, angle }));
  });

  // Bounded concurrency: a 4-angle × 3-colour batch was 12 sequential round
  // trips. Keep the cap low enough to stay clear of Gemini rate limits.
  const CONCURRENCY = 3;
  const results: GenerateCreativeResult[] = new Array(jobs.length);
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor++;
      const { sourceImage, angle } = jobs[index];
      results[index] = await generateCreativeAction({
        ...params,
        referenceImages: sourceImage.referenceImages,
        sourceImageUrl: sourceImage.imageUrl || undefined,
        sourceColor: sourceImage.color,
        viewAngle: angle,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()),
  );

  return { success: results.some(r => r.success), results };
}

// Regenerate a single existing draft with the same params + an optional user
// correction note ("e.g. no buttons on back"). Replaces the old draft in place
// so the UI tile updates without renumbering. The original creative must be in
// 'draft' status — saved creatives are immutable.
export async function regenerateCreativeAction(
  creativeId: number,
  correctionText?: string,
  quality?: CreativeGenerationQuality,
): Promise<GenerateCreativeResult> {
  try {
    const scope = await requireActionPermission('content:write');

    const original = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: {
        brand: true, status: true, productId: true, viewAngle: true,
        sourceImageUrl: true, referenceImages: true, aspectRatio: true,
        corrections: true, personaStyle: true, productContext: true,
        imageUrl: true,
      },
    });
    if (!original) return { success: false, error: 'Creative not found.' };
    if (original.status !== 'draft') {
      return { success: false, error: 'Only draft creatives can be regenerated.' };
    }
    assertBrandAccess(scope, original.brand);

    const referenceInputs = collectReferenceInputs({
      referenceImages: parseStoredReferences(original.referenceImages),
      sourceImageUrl: original.sourceImageUrl ?? undefined,
    });
    const referenceImages = await Promise.all(
      referenceInputs.map(ref => fetchReferenceImage(ref.url, ref.angle)),
    );

    // Replay every correction so a new note never undoes an earlier fix.
    const priorCorrections = parseStoredCorrections(original.corrections);
    const newCorrection = correctionText?.trim();
    const allCorrections = newCorrection && !priorCorrections.includes(newCorrection)
      ? [...priorCorrections, newCorrection]
      : priorCorrections;

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
      referenceImages,
      viewAngle: (original.viewAngle ?? undefined) as ViewAngle | undefined,
      quality,
      aspectRatio: (original.aspectRatio ?? DEFAULT_ASPECT_RATIO) as CreativeAspectRatio,
      corrections: allCorrections,
    });

    // Replace in place — keep the same id so the UI tile slot stays consistent.
    const blobUrl = await uploadGeneratedImage(result.imageData, original.brand);
    await prisma.generatedCreative.update({
      where: { id: creativeId },
      data: {
        imageUrl: blobUrl,
        generatedImageData: blobUrl ? null : result.imageData,
        prompt: result.prompt,
        corrections: allCorrections.length > 0 ? JSON.stringify(allCorrections) : null,
      },
    });
    // The superseded image is unreachable now that the row points elsewhere.
    await deleteGeneratedImage(original.imageUrl);

    return {
      success: true,
      imageData: blobUrl ?? result.imageData,
      prompt: result.prompt,
      creativeId,
      viewAngle: (original.viewAngle ?? undefined) as ViewAngle | undefined,
      grounded: result.grounded,
      corrections: allCorrections,
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
      select: { brand: true, status: true, imageUrl: true },
    });
    // Only delete drafts; saved creatives are kept
    if (!existing || existing.status !== 'draft') return { success: true };
    assertBrandAccess(scope, existing.brand);

    await prisma.generatedCreative.delete({ where: { id: creativeId } });
    await deleteGeneratedImage(existing.imageUrl);
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Point a creative at a different product, or at none.
 *
 * Splitting one product into several — three colourways of a design that
 * started as one row — leaves every creative attached to the original. The
 * images are correct; only the link is wrong, so re-linking is the repair.
 * Deleting and regenerating would cost image-generation calls, discard the
 * correction history, and still leave the originals behind.
 */
export async function relinkCreativeProduct(
  creativeId: number,
  productId: number | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const scope = await requireActionPermission('content:write');

    const existing = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: { brand: true },
    });
    if (!existing) return { success: false, error: 'Creative not found.' };
    assertBrandAccess(scope, existing.brand);

    if (productId !== null) {
      const target = await prisma.product.findUnique({
        where: { id: productId },
        select: { brand: true },
      });
      if (!target) return { success: false, error: 'Product not found.' };
      // Guard both ends: a creative must not be moved into a brand the user
      // cannot manage, nor across brands.
      assertBrandAccess(scope, target.brand);
      if (!brandsMatch(target.brand, existing.brand)) {
        return { success: false, error: 'Creative and product belong to different brands.' };
      }
    }

    await prisma.generatedCreative.update({
      where: { id: creativeId },
      data: { productId },
    });

    revalidatePath('/content');
    return { success: true };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to move creative.' };
  }
}

/**
 * Turn a creative's use as the product's customer-facing image on or off.
 *
 * Publishing adopts a creative automatically, but a published creative that
 * turns out badly had no way back: publishedAt was only ever set, so the only
 * escape was publishing a replacement. Clearing it drops the creative back
 * behind the other candidates — the next best creative, or the original photo —
 * without deleting anything.
 *
 * Adopting by hand is the other direction: use a creative you are happy with
 * without having to post it first.
 */
export async function setCreativeAdopted(
  creativeId: number,
  adopted: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const scope = await requireActionPermission('content:write');

    const existing = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: { brand: true, publishedAt: true },
    });
    if (!existing) return { success: false, error: 'Creative not found.' };
    assertBrandAccess(scope, existing.brand);

    // Keep the original adoption time when it is already set: it records when
    // the image first reached customers, and rewriting it would reshuffle which
    // creative wins the most-recent tiebreak.
    if (adopted && existing.publishedAt) return { success: true };

    await prisma.generatedCreative.update({
      where: { id: creativeId },
      data: {
        publishedAt: adopted ? new Date() : null,
        ...(adopted ? { status: 'saved' } : {}),
      },
    });

    revalidatePath('/content');
    revalidatePath('/products');
    return { success: true };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error);
    return { success: false, error: 'Failed to update creative.' };
  }
}

// Permanently delete a saved creative.
export async function deleteGeneratedCreative(creativeId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const scope = await requireActionPermission('content:write');

    const existing = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: { brand: true, imageUrl: true },
    });
    if (!existing) return { success: false, error: 'Creative not found.' };
    assertBrandAccess(scope, existing.brand);

    // A creative attached to a post is held by a restricting foreign key, so
    // the delete would fail deep in the driver and surface as "Failed to
    // delete creative." Check first and say what is actually holding it.
    const usedBy = await prisma.socialPostCreative.findMany({
      where: { creativeId },
      select: { socialPost: { select: { id: true, publishStatus: true } } },
    });

    if (usedBy.length > 0) {
      const published = usedBy.filter((entry) => entry.socialPost.publishStatus).length;
      const single = usedBy.length === 1;

      const usage = single
        ? `This creative is used by 1 ${published > 0 ? 'published ' : ''}post.`
        : `This creative is used by ${usedBy.length} posts${
            published > 0 ? `, ${published} of them published` : ''
          }.`;
      const history = published > 0
        ? ' Deleting it would lose that publish history.'
        : '';

      return {
        success: false,
        error:
          `${usage}${history} Remove it from ${single ? 'that post' : 'those posts'} first,` +
          ' or leave it — a newer published creative replaces it as the product image automatically.',
      };
    }

    await prisma.generatedCreative.delete({ where: { id: creativeId } });
    await deleteGeneratedImage(existing.imageUrl);
    revalidatePath('/content');
    revalidatePath('/products');
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
    sku: string | null;
    brand: string;
    name: string;
    price: number;
    sizes: string;
    colors: string;
    variants: Array<{ sku: string | null }>;
  } | null;
}): string {
  const product = input.product;
  const itemName = product?.name ?? parseProductContextValue(input.productContext, 'Name');
  const variantCode = product?.variants
    .map((variant) => variant.sku?.trim())
    .find((sku): sku is string => Boolean(sku));
  const itemCode = product ? displayProductSku(product) : variantCode ?? null;
  const sizes = product?.sizes ?? parseProductContextValue(input.productContext, 'Sizes');
  const colors = product?.colors ?? parseProductContextValue(input.productContext, 'Colors');
  const price = product
    ? formatRsPrice(product.price)
    : cleanDetailValue(parseProductContextValue(input.productContext, 'Price'));

  if (!itemName && !itemCode && !sizes && !colors && price === 'N/A') {
    const fallback = input.fallbackDescription?.trim();
    return fallback && fallback.toUpperCase() !== 'N/A' ? fallback : '';
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
    new Set(descriptions.map((description) => description.trim()).filter((description) => Boolean(description) && description.toUpperCase() !== 'N/A')),
  );

  if (uniqueDescriptions.length === 0) {
    return cleanCaption;
  }

  return `${cleanCaption}\n\n${uniqueDescriptions.join('\n\n')}`;
}

export async function publishSocialPost(
  postId: number,
  baseUrl?: string,
  targetChannels?: string[],
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
        captionsByChannel: true,
        status: true,
        publishLogs: {
          select: {
            id: true,
            channel: true,
            status: true,
            createdAt: true,
          },
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        },
        postCreatives: {
          select: {
            creativeId: true,
            description: true,
            creative: {
              select: {
                productContext: true,
                imageUrl: true,
                product: {
                  select: {
                    id: true,
                    sku: true,
                    brand: true,
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

    const configuredChannels = post.channels.split(',').map((c) => c.trim()).filter(Boolean);
    if (configuredChannels.length === 0) {
      return { success: false, error: 'Post has no channels configured.' };
    }

    const requestedChannels = targetChannels
      ? Array.from(new Set(targetChannels.map((channel) => channel.trim()).filter(Boolean)))
      : configuredChannels;
    const channels = requestedChannels.filter((channel) => configuredChannels.includes(channel));

    if (channels.length === 0) {
      return {
        success: false,
        error: 'No valid channels selected for this publish attempt.',
      };
    }

    const outcomes: ChannelPublishOutcome[] = [];

    const fallbackBaseUrl = baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')
      ? baseUrl.replace(/\/$/, '')
      : null;
    const imageInputs: PublishImageInput[] | undefined = post.postCreatives.length > 0
      ? post.postCreatives
        .flatMap((pc): PublishImageInput[] => {
          // Blob-backed creatives are already on a public CDN — hand Meta that
          // URL directly instead of bouncing it through a redirect. Older rows
          // still serve from the app route, which needs a signed link because
          // Meta downloads without a session.
          const blobUrl = pc.creative?.imageUrl;
          const path = creativeImagePath(pc.creativeId);
          const url = blobUrl
            ?? getPublicAssetUrl(path)
            ?? (fallbackBaseUrl ? `${fallbackBaseUrl}${path}` : null);
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
    const itemDescriptions = imageInputs?.map((image) => image.description ?? '') ?? [];
    // Each channel gets its own copy when one was written; otherwise the shared
    // caption stands in, so posts created before per-channel copy still publish.
    const channelCaptions = parseCaptionsByChannel(post.captionsByChannel);
    const captionFor = (channel: string) => appendItemDescriptions(
      channelCaptions[channel]?.trim() || post.caption,
      itemDescriptions,
    );

    for (const channel of channels) {
      let result;
      if (channel === 'facebook') {
        result = await publishToFacebook(post.brand, captionFor(channel), imageInputs);
      } else if (channel === 'instagram') {
        result = await publishToInstagram(post.brand, captionFor(channel), imageUrls);
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

    const latestStatusByChannel = new Map<string, string>();
    for (const log of post.publishLogs) {
      latestStatusByChannel.set(log.channel, log.status);
    }
    for (const outcome of outcomes) {
      latestStatusByChannel.set(outcome.channel, outcome.ok ? 'published' : 'failed');
    }

    const allOk = configuredChannels.every((channel) => latestStatusByChannel.get(channel) === 'published');
    const anyOk = configuredChannels.some((channel) => latestStatusByChannel.get(channel) === 'published');
    const attemptAllOk = outcomes.every((o) => o.ok);
    const attemptAnyOk = outcomes.some((o) => o.ok);
    const publishStatus = allOk ? 'published' : anyOk ? 'partial' : 'failed';

    const publishedAt = new Date();

    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        publishStatus,
        publishedAt,
        publishedBy: scope.email ?? null,
      },
    });

    // A creative that went out on a real post is the best image we have of the
    // garment, so adopt it as the product's customer-facing image. Only stamp
    // once — the first publish is when it reached customers, and re-publishing
    // should not reshuffle which creative wins.
    if (attemptAnyOk) {
      const creativeIds = post.postCreatives.map((entry) => entry.creativeId);
      if (creativeIds.length > 0) {
        await prisma.generatedCreative.updateMany({
          where: { id: { in: creativeIds }, publishedAt: null },
          data: { status: 'saved', publishedAt },
        });
      }
    }

    revalidatePath('/content');
    revalidatePath('/products');

    return {
      success: attemptAllOk || attemptAnyOk,
      outcomes,
      publishStatus,
      error: attemptAllOk ? undefined : 'Some channels failed to publish. See details below.',
    };
  } catch (error) {
    if (isAuthorizationError(error)) return accessDeniedResult(error) as PublishSocialPostResult;
    return { success: false, error: 'Publish failed. Please retry.' };
  }
}
