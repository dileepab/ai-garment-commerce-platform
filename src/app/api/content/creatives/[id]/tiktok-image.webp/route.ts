import { NextResponse } from 'next/server';
import sharp from 'sharp';
import prisma from '@/lib/prisma';
import { accessDeniedResponse, requireApiPermission } from '@/lib/authz';
import { verifyCreativeImageToken } from '@/lib/creative-image-token';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_TIKTOK_BYTES = 20 * 1024 * 1024;

async function readCreativeBytes(imageUrl: string | null, dataUrl: string | null): Promise<Buffer> {
  if (imageUrl) {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'https:') throw new Error('Creative image URL must use HTTPS.');

    const response = await fetch(parsed, {
      cache: 'force-cache',
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Creative image download failed (${response.status}).`);

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
      throw new Error('Creative image is too large to prepare for TikTok.');
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_SOURCE_BYTES) {
      throw new Error('Creative image is too large to prepare for TikTok.');
    }
    return bytes;
  }

  const match = dataUrl?.match(/^data:image\/[\w+.-]+;base64,(.+)$/);
  if (!match) throw new Error('Creative image data is unavailable.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new Error('Creative image is too large to prepare for TikTok.');
  }
  return bytes;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const creativeId = Number(id);
  if (!Number.isInteger(creativeId) || creativeId <= 0) {
    return new NextResponse('Invalid creative ID', { status: 400 });
  }

  const url = new URL(request.url);
  const signed = verifyCreativeImageToken(
    creativeId,
    url.searchParams.get('exp'),
    url.searchParams.get('token'),
  );
  if (!signed) {
    try {
      await requireApiPermission('content:view');
    } catch (error) {
      return accessDeniedResponse(error);
    }
  }

  try {
    const creative = await prisma.generatedCreative.findUnique({
      where: { id: creativeId },
      select: { imageUrl: true, generatedImageData: true },
    });
    if (!creative) return new NextResponse('Creative not found', { status: 404 });

    const source = await readCreativeBytes(creative.imageUrl, creative.generatedImageData);
    const metadata = await sharp(source, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height) {
      return new NextResponse('Creative dimensions could not be read', { status: 422 });
    }

    // TikTok allows 1080x1920 portrait, 1920x1080 landscape, and requires at
    // least 360 px on both axes. Scaling is proportional and never crops.
    const portraitOrSquare = metadata.height >= metadata.width;
    const width = portraitOrSquare ? 1080 : 1920;
    const height = portraitOrSquare ? 1920 : 1080;
    const { data, info } = await sharp(source, { failOn: 'error' })
      .rotate()
      .resize({ width, height, fit: 'inside', withoutEnlargement: false })
      .webp({ quality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (info.width < 360 || info.height < 360) {
      return new NextResponse('Creative dimensions are not supported by TikTok', { status: 422 });
    }
    if (data.length > MAX_TIKTOK_BYTES) {
      return new NextResponse('Prepared creative exceeds TikTok\'s 20 MB limit', { status: 422 });
    }

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(data.length),
        'Cache-Control': 'public, max-age=604800, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[TikTok Creative Image] Failed to prepare image:', error);
    return new NextResponse('Could not prepare this creative for TikTok', { status: 502 });
  }
}
