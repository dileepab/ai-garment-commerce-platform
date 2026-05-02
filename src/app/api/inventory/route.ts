import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { getProductBrandScopedWhere } from '@/lib/access-control';
import { accessDeniedResponse, isAuthorizationError, requireApiPermission } from '@/lib/authz';

export async function GET() {
  try {
    const scope = await requireApiPermission('inventory:view');
    const inventory = await prisma.inventory.findMany({
      where: getProductBrandScopedWhere(scope),
      include: { product: true }
    });
    return NextResponse.json({ success: true, data: inventory });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
