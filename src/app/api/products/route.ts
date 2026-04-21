import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');
    
    const whereClause = brand ? { brand } : {};
    
    const products = await prisma.product.findMany({
      where: whereClause,
      include: { inventory: true },
    });
    return NextResponse.json({ success: true, data: products });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    
    const sizesStr = Array.isArray(data.sizes) ? data.sizes.join(',') : data.sizes;
    const colorsStr = Array.isArray(data.colors) ? data.colors.join(',') : data.colors;
    const initialStock = data.stock || 0;

    const product = await prisma.product.create({
      data: {
        name: data.name,
        brand: data.brand,
        style: data.style,
        price: data.price,
        fabric: data.fabric,
        sizes: sizesStr,
        colors: colorsStr,
        stock: initialStock,
        inventory: {
          create: {
             availableQty: initialStock,
          }
        }
      },
    });

    return NextResponse.json({ success: true, data: product });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
