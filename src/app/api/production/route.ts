import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';

export async function GET() {
  try {
    const batches = await prisma.productionBatch.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json({ success: true, data: batches });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const batch = await prisma.productionBatch.create({
      data: {
        brand: data.brand,
        style: data.style,
        plannedQty: data.plannedQty,
      }
    });
    return NextResponse.json({ success: true, data: batch });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
