import { prisma } from './prisma.ts';

export const DEFAULT_CRITICAL_THRESHOLD = 3;
export const DEFAULT_REORDER_THRESHOLD = 10;
export const DEFAULT_LOT_SIZE = 10;
export const MIN_RESTOCK_FLOOR = 20;
export const TARGET_SUPPLY_DAYS = 30;

export interface VariantForecastInput {
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

export interface SaleRecord {
  variantId: number | null;
  productId: number;
  quantity: number;
  orderedAt: Date;
  orderStatus: string;
}

export interface VariantForecastResult {
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
  salesQty30d: number;
  salesQty90d: number;
  salesVelocity30d: number; // units/day
  salesVelocity90d: number; // units/day
  weightedVelocity: number; // weighted units/day
  daysRemaining: number; // infinity represented as 9999 or -1
  predictedSelloutDate: Date | null;
  suggestedRestockQty: number;
  stockStatus: 'out-of-stock' | 'critical' | 'low' | 'healthy' | 'overstocked';
}

export interface ProductForecastSummary {
  productId: number;
  productName: string;
  brand: string;
  totalAvailable: number;
  totalReserved: number;
  totalInProduction: number;
  mostUrgentStatus: 'out-of-stock' | 'critical' | 'low' | 'healthy' | 'overstocked';
  minDaysRemaining: number;
  predictedSelloutDate: Date | null;
  totalSuggestedRestock: number;
  variants: VariantForecastResult[];
}

// Pure helper function for testing and calculation
export function calculateForecasts(
  variants: VariantForecastInput[],
  sales: SaleRecord[],
  opts?: { now?: Date }
): VariantForecastResult[] {
  const now = opts?.now ?? new Date();
  
  const cutOff30 = new Date(now.getTime() - 30 * 86400000);
  const cutOff90 = new Date(now.getTime() - 90 * 86400000);

  const sales30d = new Map<number, number>();
  const sales90d = new Map<number, number>();

  for (const s of sales) {
    if (s.orderStatus === 'cancelled' || s.variantId === null) continue;
    if (s.orderedAt >= cutOff30) {
      sales30d.set(s.variantId, (sales30d.get(s.variantId) ?? 0) + s.quantity);
    }
    if (s.orderedAt >= cutOff90) {
      sales90d.set(s.variantId, (sales90d.get(s.variantId) ?? 0) + s.quantity);
    }
  }

  return variants.map((v) => {
    const critThresh = v.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD;
    const reordThresh = v.reorderThreshold ?? DEFAULT_REORDER_THRESHOLD;
    
    const qty30 = sales30d.get(v.variantId) ?? 0;
    const qty90 = sales90d.get(v.variantId) ?? 0;
    
    const vel30 = qty30 / 30;
    const vel90 = qty90 / 90;
    
    // 70% weight on recent 30-day velocity, 30% weight on 90-day velocity
    const weightedVelocity = 0.7 * vel30 + 0.3 * vel90;
    
    let daysRemaining = 9999;
    let predictedSelloutDate: Date | null = null;
    let stockStatus: VariantForecastResult['stockStatus'] = 'healthy';
    
    if (v.availableQty <= 0) {
      daysRemaining = 0;
      predictedSelloutDate = now;
      stockStatus = 'out-of-stock';
    } else if (weightedVelocity > 0) {
      daysRemaining = v.availableQty / weightedVelocity;
      predictedSelloutDate = new Date(now.getTime() + daysRemaining * 86400000);
      
      if (v.availableQty <= critThresh || daysRemaining <= 3) {
        stockStatus = 'critical';
      } else if (v.availableQty <= reordThresh || daysRemaining <= 10) {
        stockStatus = 'low';
      } else if (daysRemaining > 90 || v.availableQty > reordThresh * 4) {
        stockStatus = 'overstocked';
      } else {
        stockStatus = 'healthy';
      }
    } else {
      // availableQty > 0 and weightedVelocity is 0 (no sales)
      daysRemaining = 9999;
      predictedSelloutDate = null;
      if (v.availableQty > reordThresh * 2) {
        stockStatus = 'overstocked';
      } else {
        stockStatus = 'healthy';
      }
    }

    // Suggested next micro-batch restock size
    let suggestedRestockQty = 0;
    if (stockStatus === 'out-of-stock' || stockStatus === 'critical' || stockStatus === 'low') {
      // Calculate how many we need to reach TARGET_SUPPLY_DAYS or at least 2x reorder threshold
      const targetSupplyQty = weightedVelocity * TARGET_SUPPLY_DAYS;
      const minTargetQty = reordThresh * 2;
      const idealQty = Math.max(targetSupplyQty, minTargetQty);
      
      const currentCover = v.availableQty + v.inProductionQty;
      const needed = idealQty - currentCover;
      
      if (needed > 0) {
        // Round up to nearest lot size, with a minimum floor of 20
        suggestedRestockQty = Math.max(MIN_RESTOCK_FLOOR, Math.ceil(needed / DEFAULT_LOT_SIZE) * DEFAULT_LOT_SIZE);
      }
    }

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
      salesQty30d: qty30,
      salesQty90d: qty90,
      salesVelocity30d: vel30,
      salesVelocity90d: vel90,
      weightedVelocity,
      daysRemaining,
      predictedSelloutDate,
      suggestedRestockQty,
      stockStatus,
    };
  });
}

// DB-connected forecast engine
export async function getBrandForecasts(brandScope: string[] | null): Promise<ProductForecastSummary[]> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // 1. Fetch all active products matching the brand scope
  const products = await prisma.product.findMany({
    where: {
      status: 'active',
      ...(brandScope ? { brand: { in: brandScope } } : {}),
    },
    include: {
      variants: {
        include: {
          inventory: true,
        },
      },
    },
  });

  // Flat list of variants for inputs
  const variantsInput: VariantForecastInput[] = [];
  const variantIds: number[] = [];
  const productIds = products.map(p => p.id);

  for (const p of products) {
    for (const v of p.variants) {
      variantIds.push(v.id);
      variantsInput.push({
        variantId: v.id,
        productId: p.id,
        productName: p.name,
        brand: p.brand,
        size: v.size,
        color: v.color,
        availableQty: v.inventory?.availableQty ?? 0,
        reservedQty: v.inventory?.reservedQty ?? 0,
        inProductionQty: v.inventory?.inProductionQty ?? 0,
        reorderThreshold: v.inventory?.reorderThreshold ?? null,
        criticalThreshold: v.inventory?.criticalThreshold ?? null,
      });
    }
  }

  // 2. Fetch order items for these variants in the last 90 days
  const orderItems = await prisma.orderItem.findMany({
    where: {
      productId: { in: productIds },
      order: {
        orderStatus: { not: 'cancelled' },
        createdAt: { gte: ninetyDaysAgo },
      },
    },
    include: {
      order: true,
    },
  });

  const saleRecords: SaleRecord[] = orderItems.map((item) => ({
    variantId: item.variantId,
    productId: item.productId,
    quantity: item.quantity,
    orderedAt: item.order.createdAt,
    orderStatus: item.order.orderStatus,
  }));

  // 3. Compute forecasts
  const variantResults = calculateForecasts(variantsInput, saleRecords);

  // 4. Group results back by product
  const forecastsByProduct = new Map<number, VariantForecastResult[]>();
  for (const r of variantResults) {
    const list = forecastsByProduct.get(r.productId) ?? [];
    list.push(r);
    forecastsByProduct.set(r.productId, list);
  }

  const summaries: ProductForecastSummary[] = [];

  for (const p of products) {
    const productVariants = forecastsByProduct.get(p.id) ?? [];
    
    let totalAvailable = 0;
    let totalReserved = 0;
    let totalInProduction = 0;
    let totalSuggestedRestock = 0;
    
    let minDaysRemaining = 9999;
    let predictedSelloutDate: Date | null = null;
    let mostUrgentStatus: VariantForecastResult['stockStatus'] = 'healthy';

    // Status precedence order for urgency: out-of-stock > critical > low > healthy > overstocked
    const getStatusPriority = (s: VariantForecastResult['stockStatus']) => {
      if (s === 'out-of-stock') return 5;
      if (s === 'critical') return 4;
      if (s === 'low') return 3;
      if (s === 'healthy') return 2;
      return 1;
    };

    for (const vr of productVariants) {
      totalAvailable += vr.availableQty;
      totalReserved += vr.reservedQty;
      totalInProduction += vr.inProductionQty;
      totalSuggestedRestock += vr.suggestedRestockQty;

      if (vr.daysRemaining < minDaysRemaining) {
        minDaysRemaining = vr.daysRemaining;
        predictedSelloutDate = vr.predictedSelloutDate;
      }

      if (getStatusPriority(vr.stockStatus) > getStatusPriority(mostUrgentStatus)) {
        mostUrgentStatus = vr.stockStatus;
      }
    }

    // If no variants, default to product stock level
    if (productVariants.length === 0) {
      totalAvailable = p.stock;
    }

    summaries.push({
      productId: p.id,
      productName: p.name,
      brand: p.brand,
      totalAvailable,
      totalReserved,
      totalInProduction,
      mostUrgentStatus,
      minDaysRemaining: minDaysRemaining === 9999 ? -1 : minDaysRemaining,
      predictedSelloutDate,
      totalSuggestedRestock,
      variants: productVariants,
    });
  }

  return summaries;
}
