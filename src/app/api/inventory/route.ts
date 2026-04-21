import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';

export async function GET() {
  try {
    const inventory = await prisma.inventory.findMany({
      include: { product: true }
    });
    return NextResponse.json({ success: true, data: inventory });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
