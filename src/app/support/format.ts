import type { SupportThreadMessage, SupportThreadOrder } from './types';

export const SUPPORT_THREAD_MESSAGE_LIMIT = 40;
export const SUPPORT_THREAD_POLL_MS = 4000;
export const SUPPORT_TIME_ZONE = 'Asia/Colombo';

const SUPPORT_DATE_KEY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SUPPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const SUPPORT_DATE_LABEL_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SUPPORT_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const SUPPORT_LIST_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SUPPORT_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});
const SUPPORT_LIST_DATE_YEAR_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SUPPORT_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const SUPPORT_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SUPPORT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const SUPPORT_FULL_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SUPPORT_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatSupportDate(date: Date): string {
  return SUPPORT_DATE_LABEL_FORMATTER.format(date);
}

export function formatSupportTime(date: Date): string {
  return SUPPORT_TIME_FORMATTER.format(date);
}

export function getSupportDateKey(date: Date): string {
  const parts = SUPPORT_DATE_KEY_FORMATTER.formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  return `${year}-${month}-${day}`;
}

export function getSupportDateKeyFromIso(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return getSupportDateKey(date);
}

export function formatSupportMessageDateSeparator(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  const messageDateKey = getSupportDateKey(date);
  const now = new Date();
  const todayKey = getSupportDateKey(now);
  const yesterdayKey = getSupportDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  if (messageDateKey === todayKey) return 'Today';
  if (messageDateKey === yesterdayKey) return 'Yesterday';
  return SUPPORT_DATE_LABEL_FORMATTER.format(date);
}

export function formatSupportConversationListTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const dateKey = getSupportDateKey(date);
  const now = new Date();
  const todayKey = getSupportDateKey(now);
  const yesterdayKey = getSupportDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const timeLabel = SUPPORT_TIME_FORMATTER.format(date);

  if (dateKey === todayKey) return timeLabel;
  if (dateKey === yesterdayKey) return `Yesterday ${timeLabel}`;

  const dateLabel = dateKey.slice(0, 4) === todayKey.slice(0, 4)
    ? SUPPORT_LIST_DATE_FORMATTER.format(date)
    : SUPPORT_LIST_DATE_YEAR_FORMATTER.format(date);

  return `${dateLabel} ${timeLabel}`;
}

export function formatSupportFullTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return SUPPORT_FULL_TIMESTAMP_FORMATTER.format(date);
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
