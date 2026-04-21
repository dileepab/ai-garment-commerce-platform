import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';

export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
