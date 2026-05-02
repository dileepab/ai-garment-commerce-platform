import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { accessDeniedResponse, isAuthorizationError, requireApiPermission } from '@/lib/authz';

export async function GET() {
  try {
    await requireApiPermission('operators:view');
    const operators = await prisma.operator.findMany({
      include: { operatorOutputs: true }
    });
    return NextResponse.json({ success: true, data: operators });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireApiPermission('operators:write');
    const data = await request.json();
    const operator = await prisma.operator.create({
      data: {
        name: data.name,
        skill: data.skill,
        salaryBase: data.salaryBase,
      }
    });
    return NextResponse.json({ success: true, data: operator });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
