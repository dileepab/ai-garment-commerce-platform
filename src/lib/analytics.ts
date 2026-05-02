import { isActiveOrderStatus, normalizeOrderStatus } from './order-status-display';

export type DateRangePreset = '7d' | '30d' | '90d' | 'all';

export const DATE_RANGE_PRESETS: { id: DateRangePreset; label: string; days: number | null }[] = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

export function resolveDateRange(preset: string | undefined, now: Date = new Date()): {
  preset: DateRangePreset;
  from: Date | null;
  to: Date;
} {
  const match = DATE_RANGE_PRESETS.find((p) => p.id === preset);
  const chosen = match ?? DATE_RANGE_PRESETS[1]; // default 30d
  if (chosen.days === null) {
    return { preset: chosen.id, from: null, to: now };
  }
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - chosen.days + 1);
  return { preset: chosen.id, from, to: now };
}

// ── Orders & revenue ─────────────────────────────────────────────
export interface OrderLike {
  id: number;
  totalAmount: number;
  orderStatus: string;
  createdAt: Date;
  customerId?: number;
}

export interface OrderItemLike {
  productId: number;
  quantity: number;
  price: number;
  product?: { id: number; name: string; brand?: string | null } | null;
  order: { createdAt: Date; orderStatus: string };
}

export interface RevenueSummary {
  grossRevenue: number;
  netRevenue: number;
  cancelledRevenue: number;
  orderCount: number;
  paidOrderCount: number;
  cancelledCount: number;
  averageOrderValue: number;
  uniqueCustomerCount: number;
  repeatOrderCount: number;
}

export function summarizeOrders(orders: OrderLike[]): RevenueSummary {
  let grossRevenue = 0;
  let netRevenue = 0;
  let cancelledRevenue = 0;
  let cancelledCount = 0;
  let paidOrderCount = 0;
  const customers = new Map<number, number>();

  for (const o of orders) {
    const status = normalizeOrderStatus(o.orderStatus);
    grossRevenue += o.totalAmount;
    if (status === 'cancelled') {
      cancelledRevenue += o.totalAmount;
      cancelledCount += 1;
    } else {
      netRevenue += o.totalAmount;
      paidOrderCount += 1;
    }
    if (o.customerId !== undefined) {
      customers.set(o.customerId, (customers.get(o.customerId) ?? 0) + 1);
    }
  }

  let repeatOrderCount = 0;
  for (const count of customers.values()) {
    if (count > 1) repeatOrderCount += count;
  }

  return {
    grossRevenue,
    netRevenue,
    cancelledRevenue,
    orderCount: orders.length,
    paidOrderCount,
    cancelledCount,
    averageOrderValue: paidOrderCount > 0 ? netRevenue / paidOrderCount : 0,
    uniqueCustomerCount: customers.size,
    repeatOrderCount,
  };
}

export interface DailyRevenuePoint {
  date: string; // YYYY-MM-DD
  orders: number;
  revenue: number;
}

export function dailyRevenueSeries(
  orders: OrderLike[],
  from: Date,
  to: Date,
): DailyRevenuePoint[] {
  const buckets = new Map<string, DailyRevenuePoint>();
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    const key = isoDay(cursor);
    buckets.set(key, { date: key, orders: 0, revenue: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const o of orders) {
    if (normalizeOrderStatus(o.orderStatus) === 'cancelled') continue;
    const key = isoDay(new Date(o.createdAt));
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.orders += 1;
    bucket.revenue += o.totalAmount;
  }

  return Array.from(buckets.values());
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Top products ─────────────────────────────────────────────────
export interface TopProductRow {
  productId: number;
  name: string;
  brand: string | null;
  unitsSold: number;
  revenue: number;
  orderCount: number;
}

export interface OrderItemWithOrderId extends OrderItemLike {
  orderId: number;
}

export function topSellingProducts(items: OrderItemWithOrderId[], limit = 5): TopProductRow[] {
  const acc = new Map<number, {
    productId: number;
    name: string;
    brand: string | null;
    unitsSold: number;
    revenue: number;
    orderIds: Set<number>;
  }>();
  for (const item of items) {
    const status = normalizeOrderStatus(item.order.orderStatus);
    if (status === 'cancelled') continue;
    const productId = item.productId;
    const existing = acc.get(productId) ?? {
      productId,
      name: item.product?.name ?? `Product #${productId}`,
      brand: item.product?.brand ?? null,
      unitsSold: 0,
      revenue: 0,
      orderIds: new Set<number>(),
    };
    existing.unitsSold += item.quantity;
    existing.revenue += item.quantity * item.price;
    existing.orderIds.add(item.orderId);
    acc.set(productId, existing);
  }
  return Array.from(acc.values())
    .map((r) => ({
      productId: r.productId,
      name: r.name,
      brand: r.brand,
      unitsSold: r.unitsSold,
      revenue: r.revenue,
      orderCount: r.orderIds.size,
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, limit);
}

// ── AI metrics ───────────────────────────────────────────────────
export interface ChatMessageLike {
  senderId: string;
  channel: string;
  role: string;
  createdAt: Date;
}

export interface SupportEscalationLike {
  status: string;
  createdAt: Date;
  resolvedAt?: Date | null;
  customerId?: number | null;
}

export interface AiMetrics {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  uniqueConversations: number;
  responseRate: number; // assistant / user (capped 1)
  escalationCount: number;
  escalationRate: number; // escalations / unique conversations
  resolvedCount: number;
  openCount: number;
  resolutionRate: number; // resolved / total escalations
  conversionsFromCustomers: number; // unique customers who chatted AND ordered in window
  conversionRate: number; // conversions / unique conversations
}

export function summarizeAiMetrics(args: {
  messages: ChatMessageLike[];
  escalations: SupportEscalationLike[];
  convertedConversationCount: number;
}): AiMetrics {
  const { messages, escalations, convertedConversationCount } = args;
  const userMessages = messages.filter((m) => m.role === 'user').length;
  const assistantMessages = messages.filter((m) => m.role === 'assistant').length;
  const senders = new Set(messages.map((m) => `${m.channel}:${m.senderId}`));
  const uniqueConversations = senders.size;

  const escalationCount = escalations.length;
  const resolvedCount = escalations.filter((e) => e.status === 'resolved').length;
  const openCount = escalationCount - resolvedCount;

  return {
    totalMessages: messages.length,
    userMessages,
    assistantMessages,
    uniqueConversations,
    responseRate: userMessages > 0 ? Math.min(1, assistantMessages / userMessages) : 0,
    escalationCount,
    escalationRate: uniqueConversations > 0 ? escalationCount / uniqueConversations : 0,
    resolvedCount,
    openCount,
    resolutionRate: escalationCount > 0 ? resolvedCount / escalationCount : 0,
    conversionsFromCustomers: convertedConversationCount,
    conversionRate: uniqueConversations > 0 ? convertedConversationCount / uniqueConversations : 0,
  };
}

// ── Stock health ─────────────────────────────────────────────────
export interface InventoryLike {
  productId: number;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  product: { name: string; brand: string };
}

export interface StockHealth {
  totalSkus: number;
  outOfStock: number;
  critical: number; // <= 3
  low: number; // <= 10
  healthy: number;
  totalAvailable: number;
  totalReserved: number;
  totalInProduction: number;
}

export function summarizeStock(items: InventoryLike[]): StockHealth {
  let outOfStock = 0;
  let critical = 0;
  let low = 0;
  let healthy = 0;
  let totalAvailable = 0;
  let totalReserved = 0;
  let totalInProduction = 0;
  for (const i of items) {
    totalAvailable += i.availableQty;
    totalReserved += i.reservedQty;
    totalInProduction += i.inProductionQty;
    if (i.availableQty <= 0) outOfStock += 1;
    else if (i.availableQty <= 3) critical += 1;
    else if (i.availableQty <= 10) low += 1;
    else healthy += 1;
  }
  return {
    totalSkus: items.length,
    outOfStock,
    critical,
    low,
    healthy,
    totalAvailable,
    totalReserved,
    totalInProduction,
  };
}

// ── Production health ────────────────────────────────────────────
export interface ProductionBatchLike {
  status: string;
  plannedQty: number;
  finishedQty: number;
  rejectedQty: number;
}

export interface ProductionHealth {
  totalBatches: number;
  active: number;
  delayed: number;
  completed: number;
  plannedUnits: number;
  finishedUnits: number;
  rejectedUnits: number;
  completionRate: number;
  defectRate: number;
}

export function summarizeProduction(batches: ProductionBatchLike[]): ProductionHealth {
  let active = 0;
  let delayed = 0;
  let completed = 0;
  let plannedUnits = 0;
  let finishedUnits = 0;
  let rejectedUnits = 0;
  for (const b of batches) {
    plannedUnits += b.plannedQty;
    finishedUnits += b.finishedQty;
    rejectedUnits += b.rejectedQty;
    if (b.status === 'completed') completed += 1;
    else if (b.status === 'delayed') delayed += 1;
    else if (b.status !== 'cancelled') active += 1;
  }
  const totalProduced = finishedUnits + rejectedUnits;
  return {
    totalBatches: batches.length,
    active,
    delayed,
    completed,
    plannedUnits,
    finishedUnits,
    rejectedUnits,
    completionRate: plannedUnits > 0 ? finishedUnits / plannedUnits : 0,
    defectRate: totalProduced > 0 ? rejectedUnits / totalProduced : 0,
  };
}

// ── Order status breakdown ───────────────────────────────────────
export interface StatusBreakdown {
  pending: number;
  confirmed: number;
  packing: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  active: number;
}

export function statusBreakdown(orders: OrderLike[]): StatusBreakdown {
  const out: StatusBreakdown = {
    pending: 0, confirmed: 0, packing: 0, shipped: 0, delivered: 0, cancelled: 0, active: 0,
  };
  for (const o of orders) {
    const s = normalizeOrderStatus(o.orderStatus);
    if (s === 'pending') out.pending += 1;
    else if (s === 'confirmed') out.confirmed += 1;
    else if (s === 'processing' || s === 'packed') out.packing += 1;
    else if (s === 'dispatched' || s === 'shipped') out.shipped += 1;
    else if (s === 'delivered') out.delivered += 1;
    else if (s === 'cancelled') out.cancelled += 1;
    if (isActiveOrderStatus(s)) out.active += 1;
  }
  return out;
}

// ── Formatting helpers ───────────────────────────────────────────
export function formatLkr(amount: number): string {
  return `LKR ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(Math.round(amount))}`;
}

export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0%';
  return `${Math.round(ratio * 100)}%`;
}
