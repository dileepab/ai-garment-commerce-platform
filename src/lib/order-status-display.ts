import {
  getFulfillmentLabel,
  getFulfillmentNote,
  normalizeFulfillmentStatus,
  type FulfillmentStatus,
} from '@/lib/fulfillment';

export function normalizeOrderStatus(status?: string | null): string {
  return normalizeFulfillmentStatus(status);
}

export function getOrderStageLabel(status?: string | null): string {
  return getFulfillmentLabel(status);
}

export function getOrderStageNote(status?: string | null): string {
  return getFulfillmentNote(status);
}

const INACTIVE_STATUSES: ReadonlySet<FulfillmentStatus> = new Set([
  'delivered',
  'cancelled',
  'returned',
]);

export function isActiveOrderStatus(status?: string | null): boolean {
  return !INACTIVE_STATUSES.has(normalizeFulfillmentStatus(status));
}
