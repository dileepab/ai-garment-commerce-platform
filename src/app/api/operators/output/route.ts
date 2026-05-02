import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';
import { accessDeniedResponse, isAuthorizationError, requireApiPermission } from '@/lib/authz';

export async function POST(request: Request) {
  try {
    await requireApiPermission('operators:write');
    const data = await request.json();
    const output = await prisma.operatorOutput.create({
      data: {
        operatorId: data.operatorId,
        operation: data.operation,
        outputQty: data.outputQty,
        defects: data.defects || 0,
        efficiency: data.efficiency || 0,
      }
    });
    return NextResponse.json({ success: true, data: output });
  } catch (error: unknown) {
    if (isAuthorizationError(error)) {
      return accessDeniedResponse(error);
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
