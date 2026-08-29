import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || id.includes('/') || id.length > 255) {
    return new NextResponse('Not found', { status: 404 });
  }

  const property = await prisma.tikTokUrlProperty.findFirst({
    where: { fileName: id, signature: { not: null } },
    select: { signature: true },
  });
  if (!property?.signature) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(property.signature, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
