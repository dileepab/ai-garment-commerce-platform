// Inventory planning engine — variant-level stock analysis for restock decisions.
// All functions are pure and work on plain data objects so they can be unit tested
// without a database connection.

export const DEFAULT_CRITICAL_THRESHOLD = 3;
export const DEFAULT_REORDER_THRESHOLD = 10;
export const DEFAULT_SLOW_MOVING_DAYS = 30;
export const DEFAULT_SLOW_MOVING_MIN_SALES = 2;
export const DEFAULT_DEAD_STOCK_DAYS = 90;

export type VariantStockStatus = 'out-of-stock' | 'critical' | 'low' | 'healthy';

export interface VariantInventoryInput {
  variantId: number;
  productId: number;
  productName: string;
  brand: string;
  size: string;
  color: string;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  reorderThreshold: number | null;
  criticalThreshold: number | null;
}

export interface OrderSaleRecord {
  variantId: number | null;
  productId: number;
  quantity: number;
  orderedAt: Date;
  orderStatus: string;
}

export interface VariantPlanItem {
  variantId: number;
  productId: number;
  productName: string;
  brand: string;
  size: string;
  color: string;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  reorderThreshold: number;
  criticalThreshold: number;
  stockStatus: VariantStockStatus;
  suggestedRestockQty: number;
  isSlowMoving: boolean;
  isDeadStock: boolean;
  unitsSoldInWindow: number;
}

export interface InventoryRiskByBrand {
  brand: string;
  totalVariants: number;
  outOfStock: number;
  critical: number;
  low: number;
  healthy: number;
  riskScore: number;
}

export interface InventoryPlanSummary {
  totalVariants: number;
  outOfStock: number;
  critical: number;
  low: number;
  healthy: number;
  needsRestock: number;
  slowMoving: number;
  deadStock: number;
  totalAvailable: number;
  totalReserved: number;
  totalInProduction: number;
  topRestockPriorities: VariantPlanItem[];
  slowMovingVariants: VariantPlanItem[];
  deadStockVariants: VariantPlanItem[];
  riskByBrand: InventoryRiskByBrand[];
}

export function getVariantStockStatus(
  availableQty: number,
  criticalThreshold: number,
  reorderThreshold: number,
): VariantStockStatus {
  if (availableQty <= 0) return 'out-of-stock';
  if (availableQty <= criticalThreshold) return 'critical';
  if (availableQty <= reorderThreshold) return 'low';
  return 'healthy';
}

export function suggestRestockQty(availableQty: number, reorderThreshold: number): number {
  return Math.max(0, reorderThreshold * 2 - availableQty);
}

function urgencyScore(status: VariantStockStatus): number {
  if (status === 'out-of-stock') return 3;
  if (status === 'critical') return 2;
  if (status === 'low') return 1;
  return 0;
}

export function computeInventoryPlan(
  variants: VariantInventoryInput[],
  sales: OrderSaleRecord[],
  opts?: {
    slowMovingDays?: number;
    slowMovingMinSales?: number;
    deadStockDays?: number;
    now?: Date;
  },
): InventoryPlanSummary {
  const now = opts?.now ?? new Date();
  const slowMovingDays = opts?.slowMovingDays ?? DEFAULT_SLOW_MOVING_DAYS;
  const slowMovingMinSales = opts?.slowMovingMinSales ?? DEFAULT_SLOW_MOVING_MIN_SALES;
  const deadStockDays = opts?.deadStockDays ?? DEFAULT_DEAD_STOCK_DAYS;

  const slowCutoff = new Date(now.getTime() - slowMovingDays * 86400000);
  const deadCutoff = new Date(now.getTime() - deadStockDays * 86400000);

  const salesSlowWindow = new Map<number, number>();
  const salesDeadWindow = new Map<number, number>();

  for (const s of sales) {
    if (s.orderStatus === 'cancelled' || s.variantId === null) continue;
    if (s.orderedAt >= slowCutoff) {
      salesSlowWindow.set(s.variantId, (salesSlowWindow.get(s.variantId) ?? 0) + s.quantity);
    }
    if (s.orderedAt >= deadCutoff) {
      salesDeadWindow.set(s.variantId, (salesDeadWindow.get(s.variantId) ?? 0) + s.quantity);
    }
  }

  const items: VariantPlanItem[] = variants.map((v) => {
    const critThresh = v.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD;
    const reordThresh = v.reorderThreshold ?? DEFAULT_REORDER_THRESHOLD;
    const stockStatus = getVariantStockStatus(v.availableQty, critThresh, reordThresh);
    const unitsSoldInWindow = salesSlowWindow.get(v.variantId) ?? 0;
    const unitsSoldDead = salesDeadWindow.get(v.variantId) ?? 0;

    return {
      variantId: v.variantId,
      productId: v.productId,
      productName: v.productName,
      brand: v.brand,
      size: v.size,
      color: v.color,
      availableQty: v.availableQty,
      reservedQty: v.reservedQty,
      inProductionQty: v.inProductionQty,
      reorderThreshold: reordThresh,
      criticalThreshold: critThresh,
      stockStatus,
      suggestedRestockQty: suggestRestockQty(v.availableQty, reordThresh),
      isSlowMoving: v.availableQty > critThresh && unitsSoldInWindow < slowMovingMinSales,
      isDeadStock: v.availableQty > 0 && unitsSoldDead === 0,
      unitsSoldInWindow,
    };
  });

  let outOfStock = 0, critical = 0, low = 0, healthy = 0;
  let totalAvailable = 0, totalReserved = 0, totalInProduction = 0;
  let slowMoving = 0, deadStock = 0;

  for (const item of items) {
    totalAvailable += item.availableQty;
    totalReserved += item.reservedQty;
    totalInProduction += item.inProductionQty;
    if (item.stockStatus === 'out-of-stock') outOfStock++;
    else if (item.stockStatus === 'critical') critical++;
    else if (item.stockStatus === 'low') low++;
    else healthy++;
    if (item.isSlowMoving) slowMoving++;
    if (item.isDeadStock) deadStock++;
  }

  const topRestockPriorities = [...items]
    .filter((i) => i.stockStatus !== 'healthy')
    .sort((a, b) => urgencyScore(b.stockStatus) - urgencyScore(a.stockStatus) || a.availableQty - b.availableQty)
    .slice(0, 10);

  const brandMap = new Map<string, { oos: number; crit: number; low: number; healthy: number; total: number }>();
  for (const item of items) {
    const b = brandMap.get(item.brand) ?? { oos: 0, crit: 0, low: 0, healthy: 0, total: 0 };
    b.total++;
    if (item.stockStatus === 'out-of-stock') b.oos++;
    else if (item.stockStatus === 'critical') b.crit++;
    else if (item.stockStatus === 'low') b.low++;
    else b.healthy++;
    brandMap.set(item.brand, b);
  }

  const riskByBrand: InventoryRiskByBrand[] = Array.from(brandMap.entries())
    .map(([brand, b]) => ({
      brand,
      totalVariants: b.total,
      outOfStock: b.oos,
      critical: b.crit,
      low: b.low,
      healthy: b.healthy,
      riskScore: b.total > 0 ? (b.oos * 3 + b.crit * 2 + b.low) / b.total : 0,
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  return {
    totalVariants: items.length,
    outOfStock,
    critical,
    low,
    healthy,
    needsRestock: outOfStock + critical,
    slowMoving,
    deadStock,
    totalAvailable,
    totalReserved,
    totalInProduction,
    topRestockPriorities,
    slowMovingVariants: items.filter((i) => i.isSlowMoving).slice(0, 8),
    deadStockVariants: items.filter((i) => i.isDeadStock).slice(0, 8),
    riskByBrand,
  };
}

export function getVariantInventoryBrandScopedWhere(brands: string[] | null) {
  return brands ? { variant: { product: { brand: { in: brands } } } } : {};
}
