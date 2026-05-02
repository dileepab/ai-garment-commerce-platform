/* eslint-disable @typescript-eslint/no-require-imports */
// Smoke tests for src/lib/analytics.ts pure aggregation helpers.
// Run with: node scripts/analytics-helpers.test.js
//
// We require the compiled output if present, otherwise compile on the fly
// using a small ts loader. To keep this self-contained and fast, the script
// transpiles analytics.ts via the TypeScript compiler that ships with the repo.

const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const TS_FILE = path.join(__dirname, '..', 'src', 'lib', 'analytics.ts');
const STATUS_FILE = path.join(__dirname, '..', 'src', 'lib', 'order-status-display.ts');
const FULFILLMENT_FILE = path.join(__dirname, '..', 'src', 'lib', 'fulfillment.ts');

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

const fulfillmentModule = loadModule(FULFILLMENT_FILE);
const statusModule = loadModule(STATUS_FILE, { '@/lib/fulfillment': fulfillmentModule });
const analytics = loadModule(TS_FILE, { './order-status-display': statusModule });

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

const baseDay = new Date('2026-04-15T10:00:00Z');

test('resolveDateRange: defaults to 30d', () => {
  const r = analytics.resolveDateRange(undefined, baseDay);
  eq(r.preset, '30d', 'preset');
  if (!r.from) throw new Error('from should not be null');
  const days = Math.round((r.to.getTime() - r.from.getTime()) / 86400000);
  if (days < 28 || days > 30) throw new Error(`expected ~30 days, got ${days}`);
});

test('resolveDateRange: all-time has no from', () => {
  const r = analytics.resolveDateRange('all', baseDay);
  eq(r.from, null, 'from');
});

test('summarizeOrders: gross, net, AOV, repeat customers', () => {
  const orders = [
    { id: 1, totalAmount: 1000, orderStatus: 'delivered', createdAt: baseDay, customerId: 1 },
    { id: 2, totalAmount: 2000, orderStatus: 'pending',   createdAt: baseDay, customerId: 1 },
    { id: 3, totalAmount: 500,  orderStatus: 'cancelled', createdAt: baseDay, customerId: 2 },
    { id: 4, totalAmount: 1500, orderStatus: 'confirmed', createdAt: baseDay, customerId: 3 },
  ];
  const s = analytics.summarizeOrders(orders);
  eq(s.orderCount, 4);
  eq(s.paidOrderCount, 3);
  eq(s.cancelledCount, 1);
  approx(s.grossRevenue, 5000);
  approx(s.netRevenue, 4500);
  approx(s.cancelledRevenue, 500);
  approx(s.averageOrderValue, 1500);
  eq(s.uniqueCustomerCount, 3);
  eq(s.repeatOrderCount, 2); // customer 1 has 2 orders
});

test('dailyRevenueSeries: fills missing days, excludes cancelled', () => {
  const from = new Date('2026-04-13T00:00:00');
  const to = new Date('2026-04-15T00:00:00');
  const orders = [
    { id: 1, totalAmount: 100, orderStatus: 'delivered', createdAt: new Date('2026-04-13T05:00:00'), customerId: 1 },
    { id: 2, totalAmount: 200, orderStatus: 'cancelled', createdAt: new Date('2026-04-13T05:00:00'), customerId: 1 },
    { id: 3, totalAmount: 300, orderStatus: 'pending',   createdAt: new Date('2026-04-15T05:00:00'), customerId: 2 },
  ];
  const series = analytics.dailyRevenueSeries(orders, from, to);
  eq(series.length, 3);
  eq(series[0].orders, 1); approx(series[0].revenue, 100);
  eq(series[1].orders, 0); approx(series[1].revenue, 0);
  eq(series[2].orders, 1); approx(series[2].revenue, 300);
});

test('topSellingProducts: ranks by units, skips cancelled', () => {
  const items = [
    { productId: 1, quantity: 3, price: 100, product: { id: 1, name: 'Tee', brand: 'A' }, order: { createdAt: baseDay, orderStatus: 'delivered' }, orderId: 10 },
    { productId: 1, quantity: 2, price: 100, product: { id: 1, name: 'Tee', brand: 'A' }, order: { createdAt: baseDay, orderStatus: 'pending'   }, orderId: 11 },
    { productId: 2, quantity: 8, price: 50,  product: { id: 2, name: 'Cap', brand: 'B' }, order: { createdAt: baseDay, orderStatus: 'cancelled' }, orderId: 12 },
    { productId: 3, quantity: 4, price: 200, product: { id: 3, name: 'Bag', brand: 'A' }, order: { createdAt: baseDay, orderStatus: 'delivered' }, orderId: 13 },
  ];
  const top = analytics.topSellingProducts(items, 5);
  eq(top.length, 2); // cancelled product 2 excluded
  eq(top[0].productId, 1); eq(top[0].unitsSold, 5); approx(top[0].revenue, 500); eq(top[0].orderCount, 2);
  eq(top[1].productId, 3); eq(top[1].unitsSold, 4); approx(top[1].revenue, 800);
});

test('summarizeAiMetrics: response/escalation/conversion rates', () => {
  const messages = [
    { senderId: 'u1', channel: 'messenger', role: 'user', createdAt: baseDay },
    { senderId: 'u1', channel: 'messenger', role: 'assistant', createdAt: baseDay },
    { senderId: 'u2', channel: 'instagram', role: 'user', createdAt: baseDay },
  ];
  const escalations = [
    { status: 'open', createdAt: baseDay },
    { status: 'resolved', createdAt: baseDay, resolvedAt: baseDay },
  ];
  const m = analytics.summarizeAiMetrics({
    messages, escalations, convertedConversationCount: 1,
  });
  eq(m.totalMessages, 3);
  eq(m.userMessages, 2);
  eq(m.assistantMessages, 1);
  eq(m.uniqueConversations, 2);
  approx(m.responseRate, 0.5);
  eq(m.escalationCount, 2);
  approx(m.escalationRate, 1);
  eq(m.resolvedCount, 1);
  eq(m.openCount, 1);
  approx(m.resolutionRate, 0.5);
  eq(m.conversionsFromCustomers, 1);
  approx(m.conversionRate, 0.5);
});

test('summarizeStock: bands and totals', () => {
  const items = [
    { productId: 1, availableQty: 0,  reservedQty: 0, inProductionQty: 5,  product: { name: 'A', brand: 'X' } },
    { productId: 2, availableQty: 2,  reservedQty: 1, inProductionQty: 0,  product: { name: 'B', brand: 'X' } },
    { productId: 3, availableQty: 8,  reservedQty: 2, inProductionQty: 0,  product: { name: 'C', brand: 'X' } },
    { productId: 4, availableQty: 50, reservedQty: 0, inProductionQty: 0,  product: { name: 'D', brand: 'X' } },
  ];
  const s = analytics.summarizeStock(items);
  eq(s.totalSkus, 4);
  eq(s.outOfStock, 1);
  eq(s.critical, 1);
  eq(s.low, 1);
  eq(s.healthy, 1);
  eq(s.totalAvailable, 60);
  eq(s.totalReserved, 3);
  eq(s.totalInProduction, 5);
});

test('summarizeProduction: completion rate, defect rate', () => {
  const batches = [
    { status: 'in_progress', plannedQty: 100, finishedQty: 60, rejectedQty: 5 },
    { status: 'delayed',     plannedQty: 50,  finishedQty: 10, rejectedQty: 2 },
    { status: 'completed',   plannedQty: 80,  finishedQty: 80, rejectedQty: 0 },
    { status: 'cancelled',   plannedQty: 20,  finishedQty: 0,  rejectedQty: 0 },
  ];
  const p = analytics.summarizeProduction(batches);
  eq(p.totalBatches, 4);
  eq(p.active, 1);
  eq(p.delayed, 1);
  eq(p.completed, 1);
  eq(p.plannedUnits, 250);
  eq(p.finishedUnits, 150);
  eq(p.rejectedUnits, 7);
  approx(p.completionRate, 150 / 250);
  approx(p.defectRate, 7 / 157);
});

test('statusBreakdown', () => {
  const orders = [
    { id: 1, totalAmount: 0, orderStatus: 'pending',   createdAt: baseDay, customerId: 1 },
    { id: 2, totalAmount: 0, orderStatus: 'confirmed', createdAt: baseDay, customerId: 1 },
    { id: 3, totalAmount: 0, orderStatus: 'packed',    createdAt: baseDay, customerId: 1 },
    { id: 4, totalAmount: 0, orderStatus: 'dispatched',createdAt: baseDay, customerId: 1 },
    { id: 5, totalAmount: 0, orderStatus: 'delivered', createdAt: baseDay, customerId: 1 },
    { id: 6, totalAmount: 0, orderStatus: 'cancelled', createdAt: baseDay, customerId: 1 },
  ];
  const s = analytics.statusBreakdown(orders);
  eq(s.pending, 1); eq(s.confirmed, 1); eq(s.packing, 1);
  eq(s.shipped, 1); eq(s.delivered, 1); eq(s.cancelled, 1);
  eq(s.active, 4); // everything except delivered & cancelled
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll analytics helper tests passed');
}
