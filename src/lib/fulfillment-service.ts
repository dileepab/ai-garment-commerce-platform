import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logInfo, logWarn } from '@/lib/app-log';
import { sendMessengerMessage } from '@/lib/meta';
import { OrderRequestError } from '@/lib/orders';
import {
  buildCustomerNotificationMessage,
  canTransitionFulfillment,
  getFulfillmentTransitionError,
  normalizeFulfillmentStatus,
  shouldNotifyCustomerForTransition,
  transitionRestoresStock,
  type FulfillmentStatus,
} from '@/lib/fulfillment';

export interface FulfillmentTransitionInput {
  orderId: number;
  toStatus: FulfillmentStatus;
  note?: string | null;
  trackingNumber?: string | null;
  courier?: string | null;
  failureReason?: string | null;
  returnReason?: string | null;
  actor?: { email?: string | null; name?: string | null } | null;
  // When false, suppresses the customer-facing Messenger notification even
  // for normally-notifiable transitions. Cancellation paths use this so the
  // dedicated cancellation messaging stays the single source of truth.
  notifyCustomer?: boolean;
}

export interface FulfillmentTransitionResult {
  orderId: number;
  fromStatus: FulfillmentStatus;
  toStatus: FulfillmentStatus;
  customerNotified: boolean;
  notificationDeduped: boolean;
}

function buildNotificationDedupeKey(orderId: number, toStatus: FulfillmentStatus): string {
  return ['fulfillment_notification', toStatus, `order:${orderId}`].join(':');
}

async function recordNotificationOutcome(params: {
  dedupeKey: string;
  orderId: number;
  customerId: number | null;
  senderId: string;
  channel: string;
  brand: string | null;
  toStatus: FulfillmentStatus;
  message: string;
  ok: boolean;
  error?: string;
  status?: number;
}) {
  try {
    await prisma.automationActionLog.create({
      data: {
        action: `fulfillment_${params.toStatus}`,
        dedupeKey: params.dedupeKey,
        senderId: params.senderId,
        channel: params.channel,
        brand: params.brand ?? null,
        customerId: params.customerId ?? null,
        orderId: params.orderId,
        status: params.ok ? 'sent' : 'failed',
        messagePreview: params.message.slice(0, 220),
        deliveryStatus: params.status ? String(params.status) : params.ok ? 'ok' : null,
        error: params.error ?? null,
        sentAt: params.ok ? new Date() : null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // Already logged for this order/status combination — that means another
      // worker beat us to the notification. Treat as deduped silently.
      return;
    }
    logWarn('Fulfillment Service', 'Could not record fulfillment notification outcome.', {
      orderId: params.orderId,
      toStatus: params.toStatus,
      error,
    });
  }
}

async function isNotificationAlreadySent(
  dedupeKey: string,
): Promise<boolean> {
  const existing = await prisma.automationActionLog.findUnique({
    where: { dedupeKey },
    select: { status: true },
  });
  return existing?.status === 'sent';
}

interface ReleaseStockParams {
  tx: Prisma.TransactionClient;
  orderId: number;
}

async function releaseStockForOrder({ tx, orderId }: ReleaseStockParams): Promise<void> {
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
      throw new OrderRequestError(
        `Inventory is missing for product ${item.productId}, so the return cannot be processed safely.`,
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

export async function transitionFulfillment(
  input: FulfillmentTransitionInput,
): Promise<FulfillmentTransitionResult> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderStatus: true,
      brand: true,
      customer: { select: { id: true, externalId: true, channel: true } },
    },
  });

  if (!order) {
    throw new OrderRequestError(`Order #${input.orderId} was not found.`, 404);
  }

  const fromStatus = normalizeFulfillmentStatus(order.orderStatus);
  const toStatus = normalizeFulfillmentStatus(input.toStatus);

  if (!canTransitionFulfillment(order.orderStatus, toStatus)) {
    const reason =
      getFulfillmentTransitionError(order.orderStatus, toStatus) ||
      `Order #${order.id} cannot move from ${fromStatus} to ${toStatus}.`;
    throw new OrderRequestError(reason, 409);
  }

  const updateData: Prisma.OrderUpdateInput = { orderStatus: toStatus };
  if (input.trackingNumber !== undefined) {
    updateData.trackingNumber = input.trackingNumber?.trim() || null;
  }
  if (input.courier !== undefined) {
    updateData.courier = input.courier?.trim() || null;
  }
  if (input.failureReason !== undefined) {
    updateData.failureReason = input.failureReason?.trim() || null;
  }
  if (input.returnReason !== undefined) {
    updateData.returnReason = input.returnReason?.trim() || null;
  }

  const wantsCustomerNotification =
    input.notifyCustomer !== false && shouldNotifyCustomerForTransition(fromStatus, toStatus);
  const message = wantsCustomerNotification
    ? buildCustomerNotificationMessage(toStatus, {
        orderId: order.id,
        trackingNumber: input.trackingNumber ?? null,
        courier: input.courier ?? null,
        failureReason: input.failureReason ?? null,
        returnReason: input.returnReason ?? null,
      })
    : null;

  const dedupeKey = wantsCustomerNotification
    ? buildNotificationDedupeKey(order.id, toStatus)
    : null;

  let notificationDeduped = false;
  if (dedupeKey && (await isNotificationAlreadySent(dedupeKey))) {
    notificationDeduped = true;
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: updateData,
    });

    if (transitionRestoresStock(fromStatus, toStatus)) {
      await releaseStockForOrder({ tx, orderId: order.id });
    }

    await tx.orderFulfillmentEvent.create({
      data: {
        orderId: order.id,
        fromStatus,
        toStatus,
        note: input.note?.trim() || null,
        trackingNumber: input.trackingNumber?.trim() || null,
        courier: input.courier?.trim() || null,
        actorEmail: input.actor?.email ?? null,
        actorName: input.actor?.name ?? null,
        customerNotified: Boolean(message) && !notificationDeduped,
      },
    });
  });

  let customerNotified = false;
  if (message && dedupeKey && !notificationDeduped) {
    const externalId = order.customer.externalId;
    const channel = order.customer.channel || '';
    if (externalId && channel === 'messenger') {
      const result = await sendMessengerMessage(externalId, message);
      await recordNotificationOutcome({
        dedupeKey,
        orderId: order.id,
        customerId: order.customer.id ?? null,
        senderId: externalId,
        channel,
        brand: order.brand,
        toStatus,
        message,
        ok: result.ok,
        error: result.error,
        status: result.status,
      });
      customerNotified = result.ok;
      if (!result.ok) {
        logWarn('Fulfillment Service', 'Customer fulfillment notification failed.', {
          orderId: order.id,
          toStatus,
          error: result.error || result.status || 'unknown',
        });
      } else {
        logInfo('Fulfillment Service', 'Sent fulfillment notification.', {
          orderId: order.id,
          toStatus,
        });
      }
    }
  }

  if (notificationDeduped) {
    logInfo('Fulfillment Service', 'Skipped duplicate fulfillment notification.', {
      orderId: order.id,
      toStatus,
    });
  }

  return {
    orderId: order.id,
    fromStatus,
    toStatus,
    customerNotified,
    notificationDeduped,
  };
}
