import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logInfo, logWarn } from '@/lib/app-log';
import { sendMessengerMessage } from '@/lib/meta';
import {
  buildReturnCustomerNotification,
  canTransitionReturn,
  getReturnTransitionError,
  isReturnRequestStatus,
  isReturnRequestType,
  returnTransitionReconciliesStock,
  shouldNotifyCustomerForReturnTransition,
  type ReturnRequestStatus,
  type ReturnRequestType,
} from '@/lib/returns';

export interface CreateReturnRequestInput {
  orderId: number;
  type: ReturnRequestType;
  reason: string;
  requestedBy?: 'customer' | 'admin';
  adminNote?: string | null;
}

export interface TransitionReturnRequestInput {
  returnRequestId: number;
  toStatus: ReturnRequestStatus;
  adminNote?: string | null;
  replacementOrderId?: number | null;
  actor?: { email?: string | null; name?: string | null } | null;
}

export interface ReturnRequestActionResult {
  id: number;
  orderId: number;
  status: ReturnRequestStatus;
  stockReconciled: boolean;
  customerNotified: boolean;
}

export class ReturnRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ReturnRequestError';
    this.status = status;
  }
}

async function reconcileStockForOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, quantity: true, variantId: true },
  });

  for (const item of items) {
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

    const inventory = await tx.inventory.findUnique({
      where: { productId: item.productId },
    });

    if (!inventory) {
      throw new ReturnRequestError(
        `Inventory is missing for product ${item.productId}; stock reconciliation cannot proceed.`,
        409,
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
}

export async function createReturnRequest(
  input: CreateReturnRequestInput,
): Promise<{ id: number; orderId: number; status: string }> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, customerId: true, brand: true, orderStatus: true },
  });

  if (!order) {
    throw new ReturnRequestError(`Order #${input.orderId} was not found.`, 404);
  }

  if (!isReturnRequestType(input.type)) {
    throw new ReturnRequestError(`Invalid return request type: ${input.type}.`);
  }

  if (!input.reason?.trim()) {
    throw new ReturnRequestError('A reason is required to create a return or exchange request.');
  }

  const existing = await prisma.returnRequest.findFirst({
    where: {
      orderId: input.orderId,
      status: { notIn: ['rejected', 'completed'] },
    },
  });

  if (existing) {
    throw new ReturnRequestError(
      `Order #${input.orderId} already has an active ${existing.type} request (status: ${existing.status}).`,
      409,
    );
  }

  const created = await prisma.returnRequest.create({
    data: {
      orderId: input.orderId,
      customerId: order.customerId,
      brand: order.brand,
      type: input.type,
      reason: input.reason.trim(),
      status: 'requested',
      requestedBy: input.requestedBy ?? 'admin',
      adminNote: input.adminNote?.trim() || null,
    },
  });

  logInfo('Returns Service', 'Created return request.', {
    returnRequestId: created.id,
    orderId: input.orderId,
    type: input.type,
  });

  return { id: created.id, orderId: created.orderId, status: created.status };
}

export async function transitionReturnRequest(
  input: TransitionReturnRequestInput,
): Promise<ReturnRequestActionResult> {
  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: input.returnRequestId },
    include: {
      order: {
        select: {
          id: true,
          brand: true,
          customer: { select: { id: true, externalId: true, channel: true } },
        },
      },
    },
  });

  if (!returnRequest) {
    throw new ReturnRequestError(
      `Return request #${input.returnRequestId} was not found.`,
      404,
    );
  }

  const fromStatus = returnRequest.status as ReturnRequestStatus;
  const toStatus = input.toStatus;
  const type = returnRequest.type as ReturnRequestType;

  if (!isReturnRequestStatus(toStatus)) {
    throw new ReturnRequestError(`Invalid status: ${toStatus}.`);
  }

  if (!canTransitionReturn(fromStatus, toStatus)) {
    const reason =
      getReturnTransitionError(fromStatus, toStatus) ||
      `Cannot move from ${fromStatus} to ${toStatus}.`;
    throw new ReturnRequestError(reason, 409);
  }

  const shouldReconcileStock = returnTransitionReconciliesStock(toStatus);
  const isCompleting = toStatus === 'completed' || toStatus === 'rejected';

  await prisma.$transaction(async (tx) => {
    const updateData: Prisma.ReturnRequestUncheckedUpdateInput = {
      status: toStatus,
      updatedAt: new Date(),
    };

    if (input.adminNote !== undefined) {
      updateData.adminNote = input.adminNote?.trim() || null;
    }

    if (input.replacementOrderId !== undefined) {
      updateData.replacementOrderId = input.replacementOrderId;
    }

    if (isCompleting) {
      updateData.completedAt = new Date();
    }

    if (shouldReconcileStock && !returnRequest.stockReconciled) {
      await reconcileStockForOrder(tx, returnRequest.orderId);
      updateData.stockReconciled = true;
    }

    await tx.returnRequest.update({
      where: { id: returnRequest.id },
      data: updateData,
    });
  });

  const shouldNotify = shouldNotifyCustomerForReturnTransition(toStatus);
  let customerNotified = false;

  if (shouldNotify) {
    const message = buildReturnCustomerNotification(toStatus, {
      orderId: returnRequest.orderId,
      type,
      adminNote: input.adminNote ?? returnRequest.adminNote,
      replacementOrderId: input.replacementOrderId ?? returnRequest.replacementOrderId,
    });

    if (message) {
      const externalId = returnRequest.order.customer.externalId;
      const channel = returnRequest.order.customer.channel || '';

      if (externalId && channel === 'messenger') {
        const result = await sendMessengerMessage(externalId, message);
        customerNotified = result.ok;

        if (!result.ok) {
          logWarn('Returns Service', 'Return request customer notification failed.', {
            returnRequestId: returnRequest.id,
            toStatus,
            error: result.error || result.status || 'unknown',
          });
        } else {
          logInfo('Returns Service', 'Sent return request notification to customer.', {
            returnRequestId: returnRequest.id,
            toStatus,
          });
        }
      }
    }
  }

  if (shouldReconcileStock && !returnRequest.stockReconciled) {
    logInfo('Returns Service', 'Reconciled stock for returned items.', {
      returnRequestId: returnRequest.id,
      orderId: returnRequest.orderId,
    });
  }

  return {
    id: returnRequest.id,
    orderId: returnRequest.orderId,
    status: toStatus,
    stockReconciled: shouldReconcileStock ? true : returnRequest.stockReconciled,
    customerNotified,
  };
}
