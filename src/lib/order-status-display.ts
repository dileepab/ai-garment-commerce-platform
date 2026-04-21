const ORDER_STAGE_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const ORDER_STAGE_NOTES: Record<string, string> = {
  pending: 'Your order is waiting for final confirmation.',
  confirmed: 'Your order is confirmed and queued for packing.',
  processing: 'Our team is currently preparing your order.',
  packed: 'Your parcel is packed and waiting for dispatch.',
  dispatched: 'Your parcel has been handed to the courier.',
  delivered: 'Your order has been marked as delivered.',
  cancelled: 'This order has been cancelled.',
};

export function normalizeOrderStatus(status?: string | null): string {
  return status?.trim().toLowerCase() || 'pending';
}

export function getOrderStageLabel(status?: string | null): string {
  const normalizedStatus = normalizeOrderStatus(status);
  return ORDER_STAGE_LABELS[normalizedStatus] || normalizedStatus;
}

export function getOrderStageNote(status?: string | null): string {
  const normalizedStatus = normalizeOrderStatus(status);
  return ORDER_STAGE_NOTES[normalizedStatus] || `Your order is currently ${normalizedStatus}.`;
}

export function isActiveOrderStatus(status?: string | null): boolean {
  const normalizedStatus = normalizeOrderStatus(status);
  return normalizedStatus !== 'cancelled' && normalizedStatus !== 'delivered';
}
