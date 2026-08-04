import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { accessDeniedResponse, requireApiPermission } from '@/lib/authz';
import { verifyCreativeImageToken } from '@/lib/creative-image-token';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || isNaN(Number(id))) {
    return new NextResponse('Invalid creative ID', { status: 400 });
  }
  const creativeId = Number(id);

  // Meta fetches this URL while publishing and cannot carry a session, so a
  // signed link stands in for one. Every other caller must be an authenticated
  // user — without this, sequential IDs exposed every creative, drafts included.
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

    if (!creative) {
      return new NextResponse('Creative not found', { status: 404 });
    }

    // Newer creatives live in blob storage; hand the caller straight to the CDN
    // rather than pulling megabytes through this route.
    if (creative.imageUrl) {
      return NextResponse.redirect(creative.imageUrl, 302);
    }

    if (!creative.generatedImageData) {
      return new NextResponse('Creative not found', { status: 404 });
    }

    // generatedImageData is stored as a data URL: "data:image/jpeg;base64,/9j/4AAQ..."
    const match = creative.generatedImageData.match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) {
      return new NextResponse('Invalid image data format', { status: 500 });
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        // Private: these bytes sit behind a session or a signed link, so shared
        // caches must not retain them.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Failed to serve creative image:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
