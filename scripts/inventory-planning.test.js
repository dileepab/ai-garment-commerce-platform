/* eslint-disable @typescript-eslint/no-require-imports */
// Smoke tests for src/lib/inventory-planning.ts pure planning helpers.
// Run with: node scripts/inventory-planning.test.js

const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const TS_FILE = path.join(__dirname, '..', 'src', 'lib', 'inventory-planning.ts');

function transpile(filePath) {
  const ts = require('typescript');
  const source = fs.readFileSync(filePath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  });
  return result.outputText;
}

function loadModule(filePath, replacements = {}) {
  const code = transpile(filePath);
  const m = new Module(filePath);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalRequire = m.require.bind(m);
  m.require = (req) => {
    if (replacements[req]) return replacements[req];
    return originalRequire(req);
  };
  m._compile(code, filePath);
  return m.exports;
}

const lib = loadModule(TS_FILE);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`✘ ${name}`);
    console.error(err.stack || err.message);
  }
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected ${e}\n  actual   ${a}`);
}
function approx(actual, expected, label = '') {
  if (Math.abs(actual - expected) > 1e-6) {
    throw new Error(`${label}\n  expected ${expected}\n  actual   ${actual}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

// ── getVariantStockStatus ──────────────────────────────────
test('getVariantStockStatus: out-of-stock when zero', () => {
  eq(lib.getVariantStockStatus(0, 3, 10), 'out-of-stock');
});

test('getVariantStockStatus: critical at threshold', () => {
  eq(lib.getVariantStockStatus(3, 3, 10), 'critical');
  eq(lib.getVariantStockStatus(1, 3, 10), 'critical');
});

test('getVariantStockStatus: low between thresholds', () => {
  eq(lib.getVariantStockStatus(5, 3, 10), 'low');
  eq(lib.getVariantStockStatus(10, 3, 10), 'low');
});

test('getVariantStockStatus: healthy above reorder threshold', () => {
  eq(lib.getVariantStockStatus(11, 3, 10), 'healthy');
  eq(lib.getVariantStockStatus(50, 3, 10), 'healthy');
});

// ── suggestRestockQty ──────────────────────────────────────
test('suggestRestockQty: fills up to 2× reorder threshold', () => {
  // availableQty=2, reorderThreshold=10 → suggest 10*2-2=18
  eq(lib.suggestRestockQty(2, 10), 18);
});

test('suggestRestockQty: zero when already at 2× threshold', () => {
  eq(lib.suggestRestockQty(20, 10), 0);
  eq(lib.suggestRestockQty(25, 10), 0); // can't be negative
});

test('suggestRestockQty: out-of-stock gets full 2× reorder', () => {
  eq(lib.suggestRestockQty(0, 5), 10);
});

// ── computeInventoryPlan ───────────────────────────────────
const now = new Date('2026-05-03T10:00:00Z');
const day91ago = new Date(now.getTime() - 91 * 86400000);

const baseVariants = [
  { variantId: 1, productId: 1, productName: 'Top A', brand: 'BrandX', size: 'S', color: 'Black', availableQty: 0,  reservedQty: 0, inProductionQty: 0, reorderThreshold: 10, criticalThreshold: 3 },
  { variantId: 2, productId: 1, productName: 'Top A', brand: 'BrandX', size: 'M', color: 'Black', availableQty: 2,  reservedQty: 1, inProductionQty: 0, reorderThreshold: 10, criticalThreshold: 3 },
  { variantId: 3, productId: 2, productName: 'Dress B', brand: 'BrandY', size: 'S', color: 'Red', availableQty: 8,  reservedQty: 0, inProductionQty: 2, reorderThreshold: 10, criticalThreshold: 3 },
  { variantId: 4, productId: 2, productName: 'Dress B', brand: 'BrandY', size: 'M', color: 'Red', availableQty: 25, reservedQty: 0, inProductionQty: 0, reorderThreshold: 10, criticalThreshold: 3 },
];

const recentSales = [
  // variant 3 sold 3 units in last 30 days
  { variantId: 3, productId: 2, quantity: 3, orderedAt: new Date(now.getTime() - 5 * 86400000), orderStatus: 'delivered' },
  // variant 4 sold 1 unit recently (slow-moving in last 30d because < 2)
  { variantId: 4, productId: 2, quantity: 1, orderedAt: new Date(now.getTime() - 10 * 86400000), orderStatus: 'delivered' },
  // cancelled sale should be ignored
  { variantId: 2, productId: 1, quantity: 5, orderedAt: new Date(now.getTime() - 2 * 86400000), orderStatus: 'cancelled' },
  // old sale (91 days ago) — outside both windows
  { variantId: 1, productId: 1, quantity: 2, orderedAt: day91ago, orderStatus: 'delivered' },
];

test('computeInventoryPlan: stock status counts', () => {
  const plan = lib.computeInventoryPlan(baseVariants, recentSales, { now });
  eq(plan.totalVariants, 4);
  eq(plan.outOfStock, 1);  // variant 1
  eq(plan.critical, 1);    // variant 2 (availableQty=2 ≤ criticalThreshold=3)
  eq(plan.low, 1);         // variant 3 (availableQty=8 ≤ reorderThreshold=10)
  eq(plan.healthy, 1);     // variant 4 (availableQty=25)
  eq(plan.needsRestock, 2); // out-of-stock + critical
});

test('computeInventoryPlan: totals', () => {
  const plan = lib.computeInventoryPlan(baseVariants, recentSales, { now });
  eq(plan.totalAvailable, 0 + 2 + 8 + 25);
  eq(plan.totalReserved, 0 + 1 + 0 + 0);
  eq(plan.totalInProduction, 0 + 0 + 2 + 0);
});

test('computeInventoryPlan: top restock priorities sorted by urgency', () => {
  const plan = lib.computeInventoryPlan(baseVariants, recentSales, { now });
  // Should exclude healthy variant 4; sorted out-of-stock first, then critical, then low
  assert(plan.topRestockPriorities.length === 3, `expected 3 priority items, got ${plan.topRestockPriorities.length}`);
  eq(plan.topRestockPriorities[0].variantId, 1); // out-of-stock first
  eq(plan.topRestockPriorities[1].variantId, 2); // critical second
  eq(plan.topRestockPriorities[2].variantId, 3); // low third
});

test('computeInventoryPlan: suggestedRestockQty for critical variant', () => {
  const plan = lib.computeInventoryPlan(baseVariants, recentSales, { now });
  const crit = plan.topRestockPriorities.find(i => i.variantId === 2);
  // availableQty=2, reorderThreshold=10 → suggest 10*2-2=18
  eq(crit.suggestedRestockQty, 18);
});

test('computeInventoryPlan: slow-moving detection', () => {
  const plan = lib.computeInventoryPlan(baseVariants, recentSales, { now });
  // variant 4 has availableQty=25 (> criticalThreshold), sold 1 unit in 30d (< 2 = slowMovingMinSales) → slow
  // variant 2 has availableQty=2 (≤ criticalThreshold), so not flagged as slow-moving
  // variant 3 sold 3 units → not slow
  const slowIds = plan.slowMovingVariants.map(i => i.variantId);
  assert(slowIds.includes(4), 'variant 4 should be slow-moving');
  assert(!slowIds.includes(3), 'variant 3 should NOT be slow-moving');
  assert(!slowIds.includes(2), 'variant 2 is critical so not slow-moving');
});

test('computeInventoryPlan: dead-stock detection (0 sales in 90d)', () => {
  const plan = lib.computeInventoryPlan(baseVariants, recentSales, { now });
  // variant 1 is out-of-stock → not dead-stock (availableQty=0)
  // variant 2 had cancelled sale only → no confirmed sales in 90d, but availableQty=2 → dead stock
  const deadIds = plan.deadStockVariants.map(i => i.variantId);
  assert(deadIds.includes(2), 'variant 2 should be dead-stock (no non-cancelled sales in 90d)');
  assert(!deadIds.includes(1), 'out-of-stock variant 1 is not dead-stock (nothing left to sell)');
});

test('computeInventoryPlan: risk by brand scores', () => {
  const plan = lib.computeInventoryPlan(baseVariants, recentSales, { now });
  // BrandX: 2 variants — 1 out (score 3) + 1 critical (score 2) → riskScore = 5/2 = 2.5
  // BrandY: 2 variants — 1 low (score 1) + 1 healthy (score 0) → riskScore = 1/2 = 0.5
  const bx = plan.riskByBrand.find(b => b.brand === 'BrandX');
  const by = plan.riskByBrand.find(b => b.brand === 'BrandY');
  assert(bx, 'BrandX should be in riskByBrand');
  assert(by, 'BrandY should be in riskByBrand');
  approx(bx.riskScore, 2.5, 'BrandX riskScore');
  approx(by.riskScore, 0.5, 'BrandY riskScore');
  // BrandX should appear first (higher risk)
  eq(plan.riskByBrand[0].brand, 'BrandX');
});

test('computeInventoryPlan: uses default thresholds when null', () => {
  const variantsWithNullThresholds = [
    { variantId: 10, productId: 5, productName: 'P', brand: 'B', size: 'M', color: 'White',
      availableQty: 3, reservedQty: 0, inProductionQty: 0, reorderThreshold: null, criticalThreshold: null },
  ];
  const plan = lib.computeInventoryPlan(variantsWithNullThresholds, [], { now });
  // Default criticalThreshold=3, so qty=3 → critical
  eq(plan.critical, 1);
  eq(plan.topRestockPriorities[0].reorderThreshold, lib.DEFAULT_REORDER_THRESHOLD);
  eq(plan.topRestockPriorities[0].criticalThreshold, lib.DEFAULT_CRITICAL_THRESHOLD);
});

test('computeInventoryPlan: cancelled sales ignored for slow/dead-stock', () => {
  const vs = [
    { variantId: 20, productId: 9, productName: 'X', brand: 'B', size: 'L', color: 'Blue',
      availableQty: 15, reservedQty: 0, inProductionQty: 0, reorderThreshold: 10, criticalThreshold: 3 },
  ];
  const sales = [
    { variantId: 20, productId: 9, quantity: 99, orderedAt: new Date(now.getTime() - 5 * 86400000), orderStatus: 'cancelled' },
  ];
  const plan = lib.computeInventoryPlan(vs, sales, { now });
  // All sales cancelled → unitsSoldInWindow = 0 → slow-moving (< 2 threshold)
  eq(plan.slowMoving, 1);
  eq(plan.deadStock, 1);
});

test('getVariantInventoryBrandScopedWhere: returns correct Prisma filter', () => {
  const nullResult = lib.getVariantInventoryBrandScopedWhere(null);
  eq(nullResult, {});

  const brandsResult = lib.getVariantInventoryBrandScopedWhere(['BrandA', 'BrandB']);
  eq(brandsResult, { variant: { product: { brand: { in: ['BrandA', 'BrandB'] } } } });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll inventory planning tests passed');
}
