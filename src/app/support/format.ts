import type { SupportThreadMessage, SupportThreadOrder } from './types';

export const SUPPORT_THREAD_MESSAGE_LIMIT = 40;
export const SUPPORT_THREAD_POLL_MS = 4000;

export function formatSupportDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatSupportTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function serializeSupportMessage(message: {
  id: number;
  role: string;
  message: string;
  createdAt: Date;
}): SupportThreadMessage {
  return {
    id: message.id,
    role: message.role,
    message: message.message,
    createdAt: message.createdAt.toISOString(),
    createdAtLabel: formatSupportTime(message.createdAt),
  };
}

export function serializeSupportOrder(order: {
  id: number;
  orderStatus: string;
  totalAmount: number;
  paymentMethod: string | null;
  deliveryAddress: string | null;
  trackingNumber: string | null;
  courier: string | null;
  brand: string | null;
  createdAt: Date;
  orderItems?: Array<{
    id: number;
    size: string | null;
    color: string | null;
    quantity: number;
    product?: { name: string; style: string } | null;
  }>;
  returnRequests?: Array<{
    id: number;
    type: string;
    status: string;
    reason: string;
  }>;
}): SupportThreadOrder {
  return {
    id: order.id,
    orderStatus: order.orderStatus,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    deliveryAddress: order.deliveryAddress,
    trackingNumber: order.trackingNumber,
    courier: order.courier,
    brand: order.brand,
    createdAt: order.createdAt.toISOString(),
    items: (order.orderItems ?? []).map((item) => ({
      id: item.id,
      productName: item.product?.name || item.product?.style || 'Product',
      style: item.product?.style ?? null,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
    })),
    returnRequests: (order.returnRequests ?? []).map((request) => ({
      id: request.id,
      type: request.type,
      status: request.status,
      reason: request.reason,
    })),
  };
}
