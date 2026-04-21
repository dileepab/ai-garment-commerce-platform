import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';

export async function GET() {
  try {
    const customers = await prisma.customer.findMany();
    return NextResponse.json({ success: true, data: customers });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
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
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
