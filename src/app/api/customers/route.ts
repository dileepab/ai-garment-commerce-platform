import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { getBrandScopeValues } from '@/lib/access-control';
import {
  accessDeniedResponse,
  assertBrandAccess,
  isAuthorizationError,
  requireApiPermission,
} from '@/lib/authz';

export async function GET() {
  try {
    const scope = await requireApiPermission('customers:view');
    const brands = getBrandScopeValues(scope);
    const customers = await prisma.customer.findMany({
      where: brands
        ? {
            OR: [
              { preferredBrand: { in: brands } },
              { orders: { some: { brand: { in: brands } } } },
              { supportEscalations: { some: { brand: { in: brands } } } },
            ],
          }
        : {},
    });
    return NextResponse.json({ success: true, data: customers });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireApiPermission('customers:write');
    const data = await request.json();
    if (data.preferredBrand) {
      assertBrandAccess(scope, data.preferredBrand, 'brand');
    }
    const customer = await prisma.customer.create({
      data: {
        name: data.name,
        phone: data.phone,
        channel: data.channel,
        preferredBrand: data.preferredBrand
      }
    });
    return NextResponse.json({ success: true, data: customer });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
