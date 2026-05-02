import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createOrderFromCatalog, CreateOrderInput, OrderRequestError } from '@/lib/orders';
import { getBrandScopedWhere, type UserScope } from '@/lib/access-control';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function getErrorStatus(error: unknown): number {
  return error instanceof OrderRequestError ? error.status : 500;
}

async function assertOrderInputBrandAccess(scope: UserScope, data: CreateOrderInput) {
  if (data.brand) {
    assertBrandAccess(scope, data.brand, 'order brand');
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    return;
  }

  const productIds = [...new Set(data.items.map((item) => item.productId).filter(Number.isInteger))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { brand: true },
  });

  for (const product of products) {
    assertBrandAccess(scope, product.brand, 'product');
  }
}

export async function GET(request: Request) {
  try {
    const scope = await requireApiPermission('orders:view');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const whereClause = status
      ? {
          orderStatus:
            status === 'shipped' || status === 'dispatched'
              ? { in: ['shipped', 'dispatched'] }
              : status === 'packing'
                ? { in: ['packing', 'packed'] }
                : status,
        }
      : {};

    const orders = await prisma.order.findMany({
      where: {
        ...getBrandScopedWhere(scope),
        ...whereClause,
      },
      include: { orderItems: true, customer: true }
    });
    return NextResponse.json({ success: true, data: orders });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireApiPermission('orders:update');
    const data = (await request.json()) as CreateOrderInput;
    await assertOrderInputBrandAccess(scope, data);
    const order = await createOrderFromCatalog(prisma, data);

    return NextResponse.json({ success: true, data: order });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: getErrorStatus(error) }
    );
  }
}
