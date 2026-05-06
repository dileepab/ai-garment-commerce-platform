import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  if (!id || isNaN(Number(id))) {
    return new NextResponse('Invalid creative ID', { status: 400 });
  }

  try {
    const creative = await prisma.generatedCreative.findUnique({
      where: { id: Number(id) },
      select: { generatedImageData: true },
    });

    if (!creative || !creative.generatedImageData) {
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
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Failed to serve creative image:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
