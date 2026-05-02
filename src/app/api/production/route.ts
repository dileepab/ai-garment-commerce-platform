import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { getBrandScopedWhere } from '@/lib/access-control';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';

export async function GET() {
  try {
    const scope = await requireApiPermission('production:view');
    const batches = await prisma.productionBatch.findMany({
      where: getBrandScopedWhere(scope),
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json({ success: true, data: batches });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireApiPermission('production:write');
    const data = await request.json();
    assertBrandAccess(scope, data.brand, 'brand');
    const batch = await prisma.productionBatch.create({
      data: {
        brand: data.brand,
        style: data.style,
        plannedQty: data.plannedQty,
      }
    });
    return NextResponse.json({ success: true, data: batch });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
