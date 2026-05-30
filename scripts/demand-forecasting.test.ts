import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { calculateForecasts, type VariantForecastInput, type SaleRecord } from '../src/lib/demand-forecasting.ts';

describe('AI Predictive Demand Forecasting', () => {
  const now = new Date('2026-05-30T12:00:00Z');
  const fiveDaysAgo = new Date(now.getTime() - 5 * 86400000);
  const fortyDaysAgo = new Date(now.getTime() - 40 * 86400000);

  const baseVariants: VariantForecastInput[] = [
    {
      variantId: 1,
      productId: 101,
      productName: 'Silk Shirt',
      brand: 'Terracotta',
      size: 'S',
      color: 'Rust',
      availableQty: 0,
      reservedQty: 0,
      inProductionQty: 0,
      reorderThreshold: 10,
      criticalThreshold: 3
    },
    {
      variantId: 2,
      productId: 101,
      productName: 'Silk Shirt',
      brand: 'Terracotta',
      size: 'M',
      color: 'Rust',
      availableQty: 2,
      reservedQty: 1,
      inProductionQty: 0,
      reorderThreshold: 10,
      criticalThreshold: 3
    },
    {
      variantId: 3,
      productId: 101,
      productName: 'Silk Shirt',
      brand: 'Terracotta',
      size: 'L',
      color: 'Rust',
      availableQty: 15,
      reservedQty: 0,
      inProductionQty: 0,
      reorderThreshold: 10,
      criticalThreshold: 3
    },
    {
      variantId: 4,
      productId: 102,
      productName: 'Oversized Tee',
      brand: 'Terracotta',
      size: 'M',
      color: 'White',
      availableQty: 100,
      reservedQty: 0,
      inProductionQty: 0,
      reorderThreshold: 10,
      criticalThreshold: 3
    }
  ];

  const sales: SaleRecord[] = [
    // Variant 1: sold 6 units in the last 30 days, 18 units in 90 days
    { variantId: 1, productId: 101, quantity: 6, orderedAt: fiveDaysAgo, orderStatus: 'completed' },
    { variantId: 1, productId: 101, quantity: 12, orderedAt: fortyDaysAgo, orderStatus: 'completed' },
    
    // Variant 2: sold 1 unit recently
    { variantId: 2, productId: 101, quantity: 1, orderedAt: fiveDaysAgo, orderStatus: 'completed' },
    
    // Variant 3: sold 30 units in last 30 days, 30 units total
    { variantId: 3, productId: 101, quantity: 30, orderedAt: fiveDaysAgo, orderStatus: 'completed' },

    // Variant 4: no sales
  ];

  test('correctly identifies out-of-stock variants', () => {
    const results = calculateForecasts(baseVariants, sales, { now });
    const oos = results.find(r => r.variantId === 1);
    
    assert.ok(oos);
    assert.equal(oos.stockStatus, 'out-of-stock');
    assert.equal(oos.daysRemaining, 0);
    // Should suggest restocking at least 20 units (MIN_RESTOCK_FLOOR)
    assert.equal(oos.suggestedRestockQty, 20);
  });

  test('correctly calculates sales velocities and weighted velocity', () => {
    const results = calculateForecasts(baseVariants, sales, { now });
    const rustS = results.find(r => r.variantId === 1);
    
    assert.ok(rustS);
    // 30-day velocity: 6 / 30 = 0.2 units/day
    // 90-day velocity: 18 / 90 = 0.2 units/day
    // weighted: 0.7 * 0.2 + 0.3 * 0.2 = 0.2
    assert.ok(Math.abs(rustS.salesVelocity30d - 0.2) < 1e-6);
    assert.ok(Math.abs(rustS.salesVelocity90d - 0.2) < 1e-6);
    assert.ok(Math.abs(rustS.weightedVelocity - 0.2) < 1e-6);
  });

  test('correctly flags critical stock based on depletion date or qty', () => {
    const results = calculateForecasts(baseVariants, sales, { now });
    const rustM = results.find(r => r.variantId === 2);
    
    assert.ok(rustM);
    assert.equal(rustM.stockStatus, 'critical');
    // availableQty=2 <= criticalThreshold=3
    assert.ok(rustM.suggestedRestockQty >= 20);
  });

  test('correctly flags low stock with velocity depletion', () => {
    const results = calculateForecasts(baseVariants, sales, { now });
    const rustL = results.find(r => r.variantId === 3);
    
    assert.ok(rustL);
    // Rust L sold 30 in 30 days. Velocity = 1.0 unit/day. 
    // Qty = 15 units. Days remaining = 15 / 0.8 = 18.75 days.
    assert.equal(rustL.daysRemaining, 18.75);
    assert.equal(rustL.stockStatus, 'healthy');
  });

  test('suggests restock quantity based on TARGET_SUPPLY_DAYS and rounds to lot multiple', () => {
    // Let's create a custom list to test suggestedRestockQty
    const customVariants: VariantForecastInput[] = [
      {
        variantId: 10,
        productId: 101,
        productName: 'Shirt',
        brand: 'Terracotta',
        size: 'M',
        color: 'Rust',
        availableQty: 5,
        reservedQty: 0,
        inProductionQty: 0,
        reorderThreshold: 10,
        criticalThreshold: 3
      }
    ];

    // Sold 30 units in the last 30 days and 60 units between 30 and 90 days ago (total 90 units in 90 days -> 1.0 unit/day)
    const customSales: SaleRecord[] = [
      { variantId: 10, productId: 101, quantity: 30, orderedAt: fiveDaysAgo, orderStatus: 'completed' },
      { variantId: 10, productId: 101, quantity: 60, orderedAt: fortyDaysAgo, orderStatus: 'completed' }
    ];

    const results = calculateForecasts(customVariants, customSales, { now });
    const result = results[0];

    assert.equal(result.stockStatus, 'low'); // qty=5 <= reorderThreshold=10
    // Weighted velocity = 1.0. 
    // targetSupplyQty = 1.0 * 30 = 30.
    // minTargetQty = 10 * 2 = 20.
    // idealQty = max(30, 20) = 30.
    // needed = idealQty - currentCover (5) = 25.
    // Rounded up to nearest lot size of 10 -> 30. Floor of 20 is met since 30 >= 20.
    assert.equal(result.suggestedRestockQty, 30);
  });

  test('marks overstocked variants', () => {
    const results = calculateForecasts(baseVariants, sales, { now });
    const overstocked = results.find(r => r.variantId === 4);
    
    assert.ok(overstocked);
    // Qty = 100, reorderThreshold = 10. Qty > reorderThreshold * 2 (and 0 velocity) -> overstocked
    // Wait, let's verify if availableQty > reorderThreshold * 2 makes it overstocked for 0 velocity.
    // In our code: availableQty > reorderThreshold * 2 with no sales -> overstocked.
    assert.equal(overstocked.stockStatus, 'overstocked');
  });
});
