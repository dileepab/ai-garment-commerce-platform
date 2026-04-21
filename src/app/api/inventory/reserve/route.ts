import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error-message';

export async function POST(request: Request) {
  try {
    const { productId, quantity } = await request.json();
    
    // Process stock reservation in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({ where: { productId } });
      
      if (!inventory) throw new Error("Inventory not found for product");
      if (inventory.availableQty < quantity) throw new Error("OUT_OF_STOCK: Requested quantity is not available");
      
      return await tx.inventory.update({
        where: { productId },
        data: {
          availableQty: { decrement: quantity },
          reservedQty: { increment: quantity }
        }
      });
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = getErrorMessage(error);

    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('OUT_OF_STOCK') ? 400 : 500 }
    );
  }
}
