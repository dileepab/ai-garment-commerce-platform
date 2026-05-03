import { PrismaClient } from '@prisma/client';

export interface CreateOrderItemInput {
  productId: number;
  variantId?: number | null;
  quantity: number;
  size?: string;
  color?: string;
}

export interface CreateOrderInput {
  customerId: number;
  brand?: string;
  deliveryAddress?: string;
  paymentMethod?: string;
  giftWrap?: boolean;
  giftNote?: string;
  orderStatus?: string;
  items: CreateOrderItemInput[];
}

export class OrderRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'OrderRequestError';
    this.status = status;
  }
}

const ORDER_MUTABLE_STATUSES = new Set([
  'pending',
  'confirmed',
  'processing',
  'packing',
  'packed',
]);

export function isOrderMutableStatus(status?: string | null): boolean {
  return ORDER_MUTABLE_STATUSES.has(status?.trim().toLowerCase() || '');
}

export async function createOrderFromCatalog(db: PrismaClient, input: CreateOrderInput) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new OrderRequestError('At least one order item is required.');
  }

  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new OrderRequestError(`Customer ${input.customerId} was not found.`, 404);
    }

    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      include: { inventory: true },
    });

    const productMap = new Map(products.map((product) => [product.id, product]));
    const brandSet = new Set<string>();
    let totalAmount = 0;

    const orderItemsData: Array<{
      productId: number;
      variantId: number | null;
      quantity: number;
      size: string | null;
      color: string | null;
      price: number;
    }> = [];

    for (const item of input.items) {
      if (!Number.isInteger(item.productId) || item.productId <= 0) {
        throw new OrderRequestError('Each item must include a valid productId.');
      }

      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new OrderRequestError('Each item must include a quantity greater than zero.');
      }

      const product = productMap.get(item.productId);

      if (!product) {
        throw new OrderRequestError(`Product ${item.productId} was not found.`, 404);
      }

      brandSet.add(product.brand);

      const normalizedSize = item.size?.trim() || null;
      const normalizedColor = item.color?.trim() || null;

      // --- Variant-level reservation (source of truth) ---
      let resolvedVariantId: number | null = item.variantId ?? null;

      if (normalizedSize && normalizedColor) {
        // Look up variant by composite key if not already supplied
        if (!resolvedVariantId) {
          const variant = await tx.productVariant.findUnique({
            where: {
              productId_size_color: {
                productId: item.productId,
                size: normalizedSize,
                color: normalizedColor,
              },
            },
            include: { inventory: true },
          });

          if (variant) {
            resolvedVariantId = variant.id;
          }
        }

        if (resolvedVariantId) {
          const variantInventory = await tx.variantInventory.findUnique({
            where: { variantId: resolvedVariantId },
          });

          if (!variantInventory) {
            throw new OrderRequestError(
              `Variant inventory is missing for ${product.name} (${normalizedColor} ${normalizedSize}).`,
              409
            );
          }

          if (variantInventory.availableQty < item.quantity) {
            throw new OrderRequestError(
              `${product.name} (${normalizedColor} ${normalizedSize}) only has ${variantInventory.availableQty} item(s) available.`
            );
          }

          // Reserve from variant inventory
          const reserved = await tx.variantInventory.updateMany({
            where: {
              variantId: resolvedVariantId,
              availableQty: { gte: item.quantity },
            },
            data: {
              availableQty: { decrement: item.quantity },
              reservedQty: { increment: item.quantity },
            },
          });

          if (reserved.count !== 1) {
            throw new OrderRequestError(
              `${product.name} (${normalizedColor} ${normalizedSize}) no longer has enough stock available.`
            );
          }
        } else {
          // No variant record — fall back to product-level inventory
          if (!product.inventory) {
            throw new OrderRequestError(`Inventory is missing for product ${product.name}.`, 409);
          }

          if (product.inventory.availableQty < item.quantity) {
            throw new OrderRequestError(
              `${product.name} only has ${product.inventory.availableQty} item(s) available.`
            );
          }
        }
      } else {
        // Size or color not specified — check product-level inventory as a guard
        if (!product.inventory) {
          throw new OrderRequestError(`Inventory is missing for product ${product.name}.`, 409);
        }

        if (product.inventory.availableQty < item.quantity) {
          throw new OrderRequestError(
            `${product.name} only has ${product.inventory.availableQty} item(s) available.`
          );
        }
      }

      // Keep product-level inventory in sync as a derived total
      const productInventoryReserved = await tx.inventory.updateMany({
        where: {
          productId: item.productId,
          availableQty: { gte: item.quantity },
        },
        data: {
          availableQty: { decrement: item.quantity },
          reservedQty: { increment: item.quantity },
        },
      });

      if (productInventoryReserved.count !== 1 && !resolvedVariantId) {
        // Only throw if we relied solely on product-level (no variant path)
        throw new OrderRequestError(
          `${product.name} no longer has enough stock available.`
        );
      }

      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });

      const itemPrice = product.price;
      totalAmount += itemPrice * item.quantity;

      orderItemsData.push({
        productId: item.productId,
        variantId: resolvedVariantId,
        quantity: item.quantity,
        size: normalizedSize,
        color: normalizedColor,
        price: itemPrice,
      });
    }

    if (brandSet.size > 1) {
      throw new OrderRequestError('Each order must contain items from a single brand.');
    }

    const resolvedBrand = [...brandSet][0] || '';
    const requestedBrand = input.brand?.trim() || '';

    if (requestedBrand && resolvedBrand && requestedBrand !== resolvedBrand) {
      throw new OrderRequestError(
        `Order brand "${requestedBrand}" does not match the selected product brand "${resolvedBrand}".`
      );
    }

    return tx.order.create({
      data: {
        customerId: input.customerId,
        brand: requestedBrand || resolvedBrand || null,
        deliveryAddress: input.deliveryAddress?.trim() || null,
        paymentMethod: input.paymentMethod?.trim() || null,
        giftWrap: Boolean(input.giftWrap),
        giftNote: input.giftNote?.trim() || null,
        orderStatus: input.orderStatus?.trim() || 'pending',
        totalAmount,
        orderItems: {
          create: orderItemsData,
        },
      },
      include: {
        orderItems: true,
        customer: true,
      },
    });
  });
}

export async function cancelOrderById(db: PrismaClient, orderId: number) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: true,
        customer: true,
      },
    });

    if (!order) {
      throw new OrderRequestError(`Order #${orderId} was not found.`, 404);
    }

    if (order.orderStatus === 'cancelled') {
      return order;
    }

    if (!isOrderMutableStatus(order.orderStatus)) {
      throw new OrderRequestError(
        `Order #${orderId} cannot be cancelled because it is already ${order.orderStatus}.`,
        409
      );
    }

    for (const item of order.orderItems) {
      // Restore variant inventory first (source of truth)
      if (item.variantId) {
        const variantInventory = await tx.variantInventory.findUnique({
          where: { variantId: item.variantId },
        });

        if (variantInventory) {
          await tx.variantInventory.update({
            where: { variantId: item.variantId },
            data: {
              availableQty: { increment: item.quantity },
              reservedQty:
                variantInventory.reservedQty >= item.quantity
                  ? { decrement: item.quantity }
                  : 0,
            },
          });
        }
      }

      // Also restore product-level inventory (derived total)
      const inventory = await tx.inventory.findUnique({
        where: { productId: item.productId },
      });

      if (!inventory) {
        throw new OrderRequestError(
          `Inventory is missing for product ${item.productId}, so the order cannot be cancelled safely.`,
          409
        );
      }

      await tx.inventory.update({
        where: { productId: item.productId },
        data: {
          availableQty: { increment: item.quantity },
          reservedQty:
            inventory.reservedQty >= item.quantity
              ? { decrement: item.quantity }
              : 0,
        },
      });

      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }

    return tx.order.update({
      where: { id: orderId },
      data: { orderStatus: 'cancelled' },
      include: {
        orderItems: true,
        customer: true,
      },
    });
  });
}

export async function updateSingleItemOrderQuantityById(
  db: PrismaClient,
  orderId: number,
  nextQuantity: number
) {
  if (!Number.isInteger(nextQuantity) || nextQuantity <= 0) {
    throw new OrderRequestError('The updated quantity must be greater than zero.');
  }

  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        orderItems: {
          include: {
            product: {
              include: { inventory: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new OrderRequestError(`Order #${orderId} was not found.`, 404);
    }

    if (!isOrderMutableStatus(order.orderStatus)) {
      throw new OrderRequestError(
        `Order #${orderId} cannot be updated because it is already ${order.orderStatus}.`,
        409
      );
    }

    if (order.orderItems.length !== 1) {
      throw new OrderRequestError(
        'Automatic quantity updates are only supported for single-item orders right now.',
        409
      );
    }

    const existingItem = order.orderItems[0];
    const inventory = existingItem.product.inventory;

    if (!inventory) {
      throw new OrderRequestError(
        `Inventory is missing for product ${existingItem.product.name}.`,
        409
      );
    }

    if (existingItem.quantity === nextQuantity) {
      return order;
    }

    const quantityDelta = nextQuantity - existingItem.quantity;

    if (quantityDelta > 0 && inventory.availableQty < quantityDelta) {
      throw new OrderRequestError(
        `${existingItem.product.name} only has ${inventory.availableQty} additional item(s) available.`
      );
    }

    if (quantityDelta > 0) {
      // Reserve additional quantity — variant level
      if (existingItem.variantId) {
        const variantInventory = await tx.variantInventory.findUnique({
          where: { variantId: existingItem.variantId },
        });

        if (variantInventory) {
          if (variantInventory.availableQty < quantityDelta) {
            throw new OrderRequestError(
              `${existingItem.product.name} (${existingItem.color ?? ''} ${existingItem.size ?? ''}) only has ${variantInventory.availableQty} additional item(s) available.`
            );
          }

          const reserved = await tx.variantInventory.updateMany({
            where: {
              variantId: existingItem.variantId,
              availableQty: { gte: quantityDelta },
            },
            data: {
              availableQty: { decrement: quantityDelta },
              reservedQty: { increment: quantityDelta },
            },
          });

          if (reserved.count !== 1) {
            throw new OrderRequestError(
              `${existingItem.product.name} only has ${variantInventory.availableQty} additional item(s) available.`
            );
          }
        }
      }

      // Product-level sync
      const productReserved = await tx.inventory.updateMany({
        where: {
          productId: existingItem.productId,
          availableQty: { gte: quantityDelta },
        },
        data: {
          availableQty: { decrement: quantityDelta },
          reservedQty: { increment: quantityDelta },
        },
      });

      if (productReserved.count !== 1) {
        throw new OrderRequestError(
          `${existingItem.product.name} only has ${inventory.availableQty} additional item(s) available.`
        );
      }

      await tx.product.update({
        where: { id: existingItem.productId },
        data: { stock: { decrement: quantityDelta } },
      });
    } else if (quantityDelta < 0) {
      const restoredQuantity = Math.abs(quantityDelta);

      // Restore variant inventory
      if (existingItem.variantId) {
        const variantInventory = await tx.variantInventory.findUnique({
          where: { variantId: existingItem.variantId },
        });

        if (variantInventory) {
          await tx.variantInventory.update({
            where: { variantId: existingItem.variantId },
            data: {
              availableQty: { increment: restoredQuantity },
              reservedQty:
                variantInventory.reservedQty >= restoredQuantity
                  ? { decrement: restoredQuantity }
                  : 0,
            },
          });
        }
      }

      // Restore product-level inventory
      await tx.inventory.update({
        where: { productId: existingItem.productId },
        data: {
          availableQty: { increment: restoredQuantity },
          reservedQty:
            inventory.reservedQty >= restoredQuantity
              ? { decrement: restoredQuantity }
              : 0,
        },
      });

      await tx.product.update({
        where: { id: existingItem.productId },
        data: { stock: { increment: restoredQuantity } },
      });
    }

    await tx.orderItem.update({
      where: { id: existingItem.id },
      data: { quantity: nextQuantity },
    });

    return tx.order.update({
      where: { id: orderId },
      data: { totalAmount: existingItem.price * nextQuantity },
      include: {
        customer: true,
        orderItems: {
          include: { product: true },
        },
      },
    });
  });
}
