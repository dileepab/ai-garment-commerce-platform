import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createOrderFromCatalog, CreateOrderInput, OrderRequestError } from '@/lib/orders';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function getErrorStatus(error: unknown): number {
  return error instanceof OrderRequestError ? error.status : 500;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const whereClause = status
      ? {
          orderStatus:
            status === 'shipped'
              ? { in: ['shipped', 'dispatched'] }
              : status === 'packing'
                ? { in: ['packing', 'packed'] }
                : status,
        }
      : {};

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: { orderItems: true, customer: true }
    });
    return NextResponse.json({ success: true, data: orders });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as CreateOrderInput;
    const order = await createOrderFromCatalog(prisma, data);

    return NextResponse.json({ success: true, data: order });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}
