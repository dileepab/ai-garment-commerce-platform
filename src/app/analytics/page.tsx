import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import prisma from '@/lib/prisma';
import {
  getBrandScopedWhere,
  getBrandScopeValues,
} from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { getScopedConversationSenderIds } from '@/lib/conversation-scope';
import {
  DATE_RANGE_PRESETS,
  dailyRevenueSeries,
  formatLkr,
  formatPct,
  resolveDateRange,
  statusBreakdown,
  summarizeAiMetrics,
  summarizeOrders,
  summarizeProduction,
  summarizeStock,
  topSellingProducts,
} from '@/lib/analytics';
import {
  computeInventoryPlan,
  getVariantInventoryBrandScopedWhere,
} from '@/lib/inventory-planning';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ range?: string }>;

function fmt(n: number) { return new Intl.NumberFormat('en-LK').format(n); }

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await requirePagePermission('analytics:view');
  const { range } = await searchParams;
  const { preset, from, to } = resolveDateRange(range);

  const brandWhere = getBrandScopedWhere(scope);
  const brandValues = getBrandScopeValues(scope);
  const variantInventoryWhere = getVariantInventoryBrandScopedWhere(brandValues);
  const orderWhere = {
    ...brandWhere,
    ...(from ? { createdAt: { gte: from, lte: to } } : {}),
  };
  const scopedSenderIds = await getScopedConversationSenderIds(scope);
  const dateWhere = from ? { createdAt: { gte: from, lte: to } } : {};
  const chatMessageWhere = {
    ...dateWhere,
    ...(scopedSenderIds ? { senderId: { in: scopedSenderIds } } : {}),
  };

  const [
    ordersInRange,
    orderItems,
    inventoryItems,
    productionBatches,
    chatMessages,
    escalations,
    productCount,
    activeOrderCount,
    // Variant-level inventory for planning
    variantInventoryItems,
    // All variant-level sales (needed for slow-moving/dead-stock, use all-time)
    allVariantSales,
  ] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: { id: true, totalAmount: true, orderStatus: true, createdAt: true, customerId: true },
    }),
    prisma.orderItem.findMany({
      where: { order: orderWhere },
      select: {
        productId: true, quantity: true, price: true, orderId: true,
        product: { select: { id: true, name: true, brand: true } },
        order: { select: { createdAt: true, orderStatus: true } },
      },
    }),
    prisma.inventory.findMany({
      where: { product: brandValues ? { brand: { in: brandValues } } : {} },
      include: { product: { select: { name: true, brand: true } } },
    }),
    prisma.productionBatch.findMany({
      where: {
        ...brandWhere,
        ...dateWhere,
      },
      select: { status: true, plannedQty: true, finishedQty: true, rejectedQty: true },
    }),
    prisma.chatMessage.findMany({
      where: chatMessageWhere,
      select: { senderId: true, channel: true, role: true, createdAt: true },
    }),
    prisma.supportEscalation.findMany({
      where: {
        ...brandWhere,
        ...dateWhere,
      },
      select: { status: true, createdAt: true, resolvedAt: true, customerId: true },
    }),
    prisma.product.count({ where: brandWhere }),
    prisma.order.count({ where: { ...brandWhere, orderStatus: { notIn: ['delivered', 'cancelled'] } } }),
    // All variant inventory records for planning (not date-filtered — these are current stock levels)
    prisma.variantInventory.findMany({
      where: variantInventoryWhere,
      include: {
        variant: {
          include: { product: { select: { id: true, name: true, brand: true } } },
        },
      },
    }),
    // All variant-level order items (all-time for dead-stock detection)
    prisma.orderItem.findMany({
      where: { variantId: { not: null }, order: brandWhere },
      select: {
        variantId: true, productId: true, quantity: true,
        order: { select: { createdAt: true, orderStatus: true } },
      },
    }),
  ]);

  // Compute conversions: chat senderIds that resolve to customers who ordered in window
  const senderIds = Array.from(new Set(chatMessages.map((m) => m.senderId)));
  const orderingCustomerIds = new Set(
    ordersInRange
      .filter((o) => o.orderStatus.toLowerCase() !== 'cancelled')
      .map((o) => o.customerId),
  );
  let convertedConversationCount = 0;
  if (senderIds.length > 0 && orderingCustomerIds.size > 0) {
    const matchedCustomers = await prisma.customer.findMany({
      where: { externalId: { in: senderIds } },
      select: { id: true },
    });
    convertedConversationCount = matchedCustomers.filter((c) => orderingCustomerIds.has(c.id)).length;
  }

  const revenue = summarizeOrders(ordersInRange);
  const status = statusBreakdown(ordersInRange);
  const top = topSellingProducts(orderItems, 8);
  const stock = summarizeStock(inventoryItems);
  const production = summarizeProduction(productionBatches);
  const ai = summarizeAiMetrics({ messages: chatMessages, escalations, convertedConversationCount });

  const seriesFrom = from ?? (ordersInRange.length > 0
    ? new Date(Math.min(...ordersInRange.map((o) => o.createdAt.getTime())))
    : new Date(to.getTime() - 29 * 86400000));
  const series = dailyRevenueSeries(ordersInRange, seriesFrom, to);
  const peakRevenue = Math.max(1, ...series.map((p) => p.revenue));

  const lowStockProducts = inventoryItems
    .filter((i) => i.availableQty <= 10)
    .sort((a, b) => a.availableQty - b.availableQty)
    .slice(0, 8);

  // Build inventory plan from variant-level data
  const planVariants = variantInventoryItems.map((vi) => ({
    variantId: vi.variantId,
    productId: vi.variant.productId,
    productName: vi.variant.product.name,
    brand: vi.variant.product.brand,
    size: vi.variant.size,
    color: vi.variant.color,
    availableQty: vi.availableQty,
    reservedQty: vi.reservedQty,
    inProductionQty: vi.inProductionQty,
    reorderThreshold: vi.reorderThreshold,
    criticalThreshold: vi.criticalThreshold,
  }));

  const saleRecords = allVariantSales.map((oi) => ({
    variantId: oi.variantId,
    productId: oi.productId,
    quantity: oi.quantity,
    orderedAt: oi.order.createdAt,
    orderStatus: oi.order.orderStatus,
  }));

  const plan = computeInventoryPlan(planVariants, saleRecords);

  const rangeLabel = DATE_RANGE_PRESETS.find((r) => r.id === preset)?.label ?? '';
  const rangeSubtitle = from
    ? `${from.toLocaleDateString('en-LK', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('en-LK', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Across all recorded data';

  return (
    <main className="main">
      <PageHeader
        title="Analytics & Reporting"
        subtitle={`${rangeLabel} · ${rangeSubtitle}`}
        actions={
          <div style={{ display: 'flex', gap: 6 }} className="analytics-range-btns">
            {DATE_RANGE_PRESETS.map((r) => {
              const active = r.id === preset;
              return (
                <Link
                  key={r.id}
                  href={r.id === '30d' ? '/analytics' : `/analytics?range=${r.id}`}
                  style={{
                    ...rangeBtn,
                    background: active ? '#18160F' : '#fff',
                    color: active ? '#fff' : '#18160F',
                    borderColor: active ? '#18160F' : '#D8D3CB',
                  }}
                >
                  {r.label}
                </Link>
              );
            })}
          </div>
        }
      />

      <div className="content">
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Headline KPIs ────────────────────────────────── */}
          <div className="analytics-kpi-4" style={{ gap: 12, marginBottom: 16 }}>
            <KpiCard label="Net Revenue" value={formatLkr(revenue.netRevenue)} note={`${fmt(revenue.paidOrderCount)} paid orders`} accent="#1E6B45" />
            <KpiCard label="Avg Order Value" value={formatLkr(revenue.averageOrderValue)} note="Excludes cancellations" accent="#1E3452" />
            <KpiCard label="Customers" value={fmt(revenue.uniqueCustomerCount)} note={`${fmt(revenue.repeatOrderCount)} repeat orders`} accent="#C4622D" />
            <KpiCard label="Cancellations" value={fmt(revenue.cancelledCount)} note={`${formatLkr(revenue.cancelledRevenue)} lost`} accent={revenue.cancelledCount > 0 ? '#8B2020' : '#9C9188'} />
          </div>

          {/* ── Daily revenue trend ─────────────────────────── */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={cardHeader}>
              <span style={cardTitle}>Daily Revenue</span>
              <span style={{ fontSize: 11, color: '#9C9188' }}>{series.length} day{series.length === 1 ? '' : 's'}</span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              {series.every((p) => p.revenue === 0) ? (
                <div style={{ padding: '36px 0', textAlign: 'center', color: '#9C9188', fontSize: 13 }}>
                  No revenue recorded in this window.
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
                  {series.map((p) => {
                    const h = Math.max(2, Math.round((p.revenue / peakRevenue) * 130));
                    return (
                      <div key={p.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }} title={`${p.date} · ${formatLkr(p.revenue)} · ${p.orders} orders`}>
                        <div style={{ width: '100%', height: h, background: p.revenue > 0 ? '#C4622D' : '#EAE6E0', borderRadius: 3 }} />
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10, color: '#9C9188' }}>
                <span>{series[0]?.date ?? ''}</span>
                <span>Peak: {formatLkr(peakRevenue)}</span>
                <span>{series[series.length - 1]?.date ?? ''}</span>
              </div>
            </div>
          </div>

          {/* ── Order status + top products ──────────────────── */}
          <div className="analytics-two-col" style={{ gap: 16, marginBottom: 16 }}>
            {/* Order status */}
            <div style={card}>
              <div style={cardHeader}>
                <span style={cardTitle}>Order Status Mix</span>
                <Link href="/orders" style={cardAction}>Manage orders →</Link>
              </div>
              <div style={{ padding: '12px 16px' }}>
                {[
                  { label: 'Pending', value: status.pending, color: '#E8C840' },
                  { label: 'Confirmed', value: status.confirmed, color: '#4A7AA8' },
                  { label: 'Packing', value: status.packing, color: '#8B5CF6' },
                  { label: 'Shipped', value: status.shipped, color: '#38A169' },
                  { label: 'Delivered', value: status.delivered, color: '#1E6B45' },
                  { label: 'Cancelled', value: status.cancelled, color: '#8B2020' },
                ].map((row) => {
                  const pct = revenue.orderCount > 0 ? row.value / revenue.orderCount : 0;
                  return (
                    <div key={row.label} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: '#18160F', fontWeight: 600 }}>{row.label}</span>
                        <span style={{ color: '#9C9188' }}>{fmt(row.value)} · {formatPct(pct)}</span>
                      </div>
                      <div style={{ background: '#EAE6E0', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: row.color, borderRadius: 99 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top products */}
            <div style={card}>
              <div style={cardHeader}>
                <span style={cardTitle}>Top Selling Products</span>
                <Link href="/products" style={cardAction}>Catalog →</Link>
              </div>
              <div style={{ padding: '0 16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Product', 'Brand', 'Units', 'Revenue', 'Orders'].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {top.length === 0 ? (
                      <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#9C9188', padding: '24px 0' }}>No sales in this window.</td></tr>
                    ) : top.map((row) => (
                      <tr key={row.productId} style={{ borderBottom: '1px solid #EAE6E0' }}>
                        <td style={{ ...td, fontWeight: 600 }}>{row.name}</td>
                        <td style={{ ...td, color: '#6A635A' }}>{row.brand ?? '—'}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{fmt(row.unitsSold)}</td>
                        <td style={{ ...td, color: '#1E6B45', fontWeight: 600 }}>{formatLkr(row.revenue)}</td>
                        <td style={{ ...td, color: '#6A635A' }}>{fmt(row.orderCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── AI performance ───────────────────────────────── */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={cardHeader}>
              <span style={cardTitle}>AI Performance ({rangeLabel.toLowerCase()})</span>
              <Link href="/support" style={cardAction}>Support inbox →</Link>
            </div>
            <div className="analytics-ai-6">
              <Metric val={fmt(ai.totalMessages)} label="Messages" note={`${fmt(ai.uniqueConversations)} convos`} />
              <Metric val={formatPct(ai.responseRate)} label="Response Rate" note="Replied vs received" good={ai.responseRate >= 0.9} />
              <Metric val={formatPct(ai.conversionRate)} label="Conversion Rate" note={`${fmt(ai.conversionsFromCustomers)} converted`} good={ai.conversionRate > 0} />
              <Metric val={formatPct(ai.escalationRate)} label="Escalation Rate" note={`${fmt(ai.escalationCount)} cases`} good={ai.escalationRate < 0.1} bad={ai.escalationRate >= 0.25} />
              <Metric val={fmt(ai.openCount)} label="Open Cases" note="Need follow-up" good={ai.openCount === 0} bad={ai.openCount > 5} />
              <Metric val={formatPct(ai.resolutionRate)} label="Resolution Rate" note={`${fmt(ai.resolvedCount)} resolved`} good={ai.resolutionRate >= 0.8} />
            </div>
          </div>

          {/* ── Stock + production ───────────────────────────── */}
          <div className="analytics-half-half" style={{ gap: 16, marginBottom: 16 }}>
            <div style={card}>
              <div style={cardHeader}>
                <span style={cardTitle}>Stock Health (Product Level)</span>
                <Link href="/products" style={cardAction}>Reorder →</Link>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
                  <MiniStat val={fmt(stock.outOfStock)} label="Out of stock" color="#8B2020" />
                  <MiniStat val={fmt(stock.critical)} label="Critical (≤3)" color="#8B2020" />
                  <MiniStat val={fmt(stock.low)} label="Low (≤10)" color="#9B6B00" />
                  <MiniStat val={fmt(stock.healthy)} label="Healthy" color="#1E6B45" />
                </div>
                <div style={{ fontSize: 11, color: '#9C9188', marginBottom: 6 }}>
                  {fmt(stock.totalAvailable)} units available · {fmt(stock.totalReserved)} reserved · {fmt(stock.totalInProduction)} in production
                </div>
                {lowStockProducts.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9C9188', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Lowest stock SKUs
                    </div>
                    {lowStockProducts.map((i, idx) => (
                      <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: idx < lowStockProducts.length - 1 ? '1px solid #EAE6E0' : 'none', fontSize: 12 }}>
                        <span style={{ color: '#18160F', fontWeight: 500 }}>{i.product.name}</span>
                        <span style={{ color: i.availableQty <= 3 ? '#8B2020' : '#9B6B00', fontWeight: 700 }}>{i.availableQty} left</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={card}>
              <div style={cardHeader}>
                <span style={cardTitle}>Production Health</span>
                <Link href="/production" style={cardAction}>All batches →</Link>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
                  <MiniStat val={fmt(production.active)} label="Active batches" color="#1E3452" />
                  <MiniStat val={fmt(production.delayed)} label="Delayed" color={production.delayed > 0 ? '#8B2020' : '#9C9188'} />
                  <MiniStat val={fmt(production.completed)} label="Completed" color="#1E6B45" />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#18160F', fontWeight: 600 }}>Completion</span>
                    <span style={{ color: '#9C9188' }}>{fmt(production.finishedUnits)}/{fmt(production.plannedUnits)} units · {formatPct(production.completionRate)}</span>
                  </div>
                  <div style={{ background: '#EAE6E0', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.round(production.completionRate * 100))}%`, height: '100%', background: '#C4622D', borderRadius: 99 }} />
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#18160F', fontWeight: 600 }}>Defect rate</span>
                    <span style={{ color: production.defectRate > 0.05 ? '#8B2020' : '#9C9188' }}>
                      {fmt(production.rejectedUnits)} rejected · {formatPct(production.defectRate)}
                    </span>
                  </div>
                  <div style={{ background: '#EAE6E0', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.round(production.defectRate * 100))}%`, height: '100%', background: production.defectRate > 0.05 ? '#8B2020' : '#9B6B00', borderRadius: 99 }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Inventory Planning (Variant Level) ──────────── */}
          {plan.totalVariants > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={cardHeader}>
                <span style={cardTitle}>Inventory Planning · Variant Level</span>
                <Link href="/products" style={cardAction}>Manage catalog →</Link>
              </div>

              {/* Summary row */}
              <div className="analytics-plan-6">
                <PlanStat val={fmt(plan.totalVariants)} label="Total variants" note="all size/color SKUs" color="#18160F" />
                <PlanStat val={fmt(plan.outOfStock)} label="Out of stock" note="zero available" color={plan.outOfStock > 0 ? '#8B2020' : '#9C9188'} />
                <PlanStat val={fmt(plan.critical)} label="Critical" note={`≤ threshold`} color={plan.critical > 0 ? '#8B2020' : '#9C9188'} />
                <PlanStat val={fmt(plan.low)} label="Low stock" note="needs monitoring" color={plan.low > 0 ? '#9B6B00' : '#9C9188'} />
                <PlanStat val={fmt(plan.slowMoving)} label="Slow moving" note="< 2 sales in 30d" color={plan.slowMoving > 0 ? '#9B6B00' : '#9C9188'} />
                <PlanStat val={fmt(plan.deadStock)} label="Dead stock" note="0 sales in 90d" color={plan.deadStock > 0 ? '#8B2020' : '#9C9188'} />
              </div>

              {/* Restock priorities table */}
              {plan.topRestockPriorities.length > 0 && (
                <div style={{ padding: '12px 16px 0' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9C9188', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                    Top Restock Priorities
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Product', 'Brand', 'Variant', 'Available', 'In Prod', 'Reorder At', 'Suggest +', 'Status'].map((h) => (
                          <th key={h} style={th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {plan.topRestockPriorities.map((item, idx) => {
                        const isCrit = item.stockStatus === 'critical' || item.stockStatus === 'out-of-stock';
                        const pillBg = item.stockStatus === 'out-of-stock' ? '#F5D8D8' : isCrit ? '#FCE2E2' : '#FFF0C2';
                        const pillColor = item.stockStatus === 'out-of-stock' ? '#701919' : isCrit ? '#8B2020' : '#7A5400';
                        const pillLabel = item.stockStatus === 'out-of-stock' ? 'Out' : isCrit ? 'Critical' : 'Low';
                        return (
                          <tr key={item.variantId} style={{ borderBottom: idx < plan.topRestockPriorities.length - 1 ? '1px solid #EAE6E0' : 'none' }}>
                            <td style={{ ...td, fontWeight: 600 }}>{item.productName}</td>
                            <td style={{ ...td, color: '#6A635A' }}>{item.brand}</td>
                            <td style={td}>
                              <span style={varChip}>{item.size}</span>
                              <span style={varChip}>{item.color}</span>
                            </td>
                            <td style={{ ...td, fontWeight: 700, color: isCrit ? '#8B2020' : '#9B6B00' }}>{item.availableQty}</td>
                            <td style={{ ...td, color: '#9C9188' }}>{item.inProductionQty}</td>
                            <td style={{ ...td, color: '#6A635A' }}>{item.reorderThreshold}</td>
                            <td style={{ ...td, fontWeight: 600, color: '#1E6B45' }}>+{item.suggestedRestockQty}</td>
                            <td style={td}>
                              <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: pillBg, color: pillColor }}>
                                {pillLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Risk by brand */}
              {plan.riskByBrand.length > 0 && (
                <div style={{ padding: '14px 16px 16px', borderTop: '1px solid #EAE6E0', marginTop: plan.topRestockPriorities.length > 0 ? 12 : 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9C9188', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
                    Risk Concentration by Brand
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {plan.riskByBrand.map((b) => {
                      const riskPct = b.totalVariants > 0 ? ((b.outOfStock + b.critical + b.low) / b.totalVariants) : 0;
                      const riskColor = riskPct >= 0.6 ? '#8B2020' : riskPct >= 0.3 ? '#9B6B00' : '#1E6B45';
                      return (
                        <div key={b.brand}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, color: '#18160F' }}>{b.brand}</span>
                            <span style={{ color: '#9C9188' }}>
                              {b.outOfStock > 0 && <span style={{ color: '#8B2020' }}>{b.outOfStock} out · </span>}
                              {b.critical > 0 && <span style={{ color: '#8B2020' }}>{b.critical} critical · </span>}
                              {b.low > 0 && <span style={{ color: '#9B6B00' }}>{b.low} low · </span>}
                              <span style={{ color: '#1E6B45' }}>{b.healthy} healthy</span>
                              {' · '}{b.totalVariants} total
                            </span>
                          </div>
                          <div style={{ background: '#EAE6E0', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.round(riskPct * 100)}%`, height: '100%', background: riskColor, borderRadius: 99 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Slow moving + dead stock lists */}
              {(plan.slowMovingVariants.length > 0 || plan.deadStockVariants.length > 0) && (
                <div className="analytics-half-half" style={{ borderTop: '1px solid #EAE6E0' }}>
                  {plan.slowMovingVariants.length > 0 && (
                    <div style={{ padding: '12px 16px', borderRight: plan.deadStockVariants.length > 0 ? '1px solid #EAE6E0' : 'none' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9B6B00', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                        Slow Moving (&lt; 2 sales in 30d)
                      </div>
                      {plan.slowMovingVariants.map((item, idx) => (
                        <div key={item.variantId} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: idx < plan.slowMovingVariants.length - 1 ? '1px solid #EAE6E0' : 'none', fontSize: 12 }}>
                          <div>
                            <span style={{ fontWeight: 600, color: '#18160F' }}>{item.productName}</span>
                            <span style={{ color: '#9C9188', marginLeft: 6 }}>{item.size}/{item.color}</span>
                          </div>
                          <span style={{ color: '#9B6B00', fontWeight: 600 }}>{item.availableQty} left · {item.unitsSoldInWindow} sold</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {plan.deadStockVariants.length > 0 && (
                    <div style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#8B2020', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                        Dead Stock (0 sales in 90d)
                      </div>
                      {plan.deadStockVariants.map((item, idx) => (
                        <div key={item.variantId} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: idx < plan.deadStockVariants.length - 1 ? '1px solid #EAE6E0' : 'none', fontSize: 12 }}>
                          <div>
                            <span style={{ fontWeight: 600, color: '#18160F' }}>{item.productName}</span>
                            <span style={{ color: '#9C9188', marginLeft: 6 }}>{item.size}/{item.color}</span>
                          </div>
                          <span style={{ color: '#8B2020', fontWeight: 600 }}>{item.availableQty} units stalled</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Footer context ───────────────────────────────── */}
          <div style={{ fontSize: 11, color: '#9C9188', textAlign: 'center', padding: '10px 0' }}>
            {fmt(productCount)} products in catalog · {fmt(activeOrderCount)} active orders overall
            {plan.totalVariants > 0 && ` · ${fmt(plan.totalVariants)} variant SKUs tracked`}
          </div>
        </div>
      </div>
    </main>
  );
};

// ── Sub-components ─────────────────────────────────────────────
function KpiCard({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#9C9188', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.04em', color: '#18160F', lineHeight: 1, marginBottom: 6 }}>{value}</div>
      <div style={{ fontSize: 11, color: accent, fontWeight: 600 }}>{note}</div>
    </div>
  );
}

function Metric({ val, label, note, good, bad }: { val: string; label: string; note: string; good?: boolean; bad?: boolean }) {
  const color = bad ? '#8B2020' : good ? '#1E6B45' : '#18160F';
  return (
    <div style={{ padding: '14px 16px', borderLeft: '1px solid #EAE6E0' }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 3, color }}>{val}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6A635A', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: '#9C9188' }}>{note}</div>
    </div>
  );
}

function MiniStat({ val, label, color }: { val: string; label: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', color }}>{val}</div>
      <div style={{ fontSize: 11, color: '#9C9188' }}>{label}</div>
    </div>
  );
}

function PlanStat({ val, label, note, color }: { val: string; label: string; note: string; color: string }) {
  return (
    <div style={{ padding: '14px 16px', borderLeft: '1px solid #EAE6E0' }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 3, color }}>{val}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6A635A', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: '#9C9188' }}>{note}</div>
    </div>
  );
}

// ── Style constants ─────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #EAE6E0',
  borderRadius: 10,
  boxShadow: '0 1px 3px rgba(24,22,15,0.07), 0 1px 2px rgba(24,22,15,0.04)',
  overflow: 'hidden',
};
const cardHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px', borderBottom: '1px solid #EAE6E0',
};
const cardTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: '#9C9188',
};
const cardAction: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#C4622D', textDecoration: 'none',
};
const th: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
  color: '#9C9188', padding: '8px 12px 8px', textAlign: 'left', borderBottom: '1px solid #EAE6E0',
};
const td: React.CSSProperties = {
  fontSize: 13, color: '#18160F', padding: '9px 12px',
};
const varChip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '1px 7px', borderRadius: 4, fontSize: 11, fontWeight: 500,
  background: '#fff', border: '1px solid #D8D3CB', color: '#6A635A', marginRight: 3,
};
const topbar: React.CSSProperties = {
  height: 60, background: '#fff',
  borderBottom: '1px solid #EAE6E0',
  display: 'flex', alignItems: 'center',
  padding: '0 28px', gap: 12,
  position: 'sticky', top: 0, zIndex: 100,
};
const topTitle: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', Georgia, serif",
  fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1, color: '#18160F',
};
const topSubtitle: React.CSSProperties = {
  fontSize: 11, color: '#9C9188', marginTop: 2,
};
const rangeBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '7px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
  border: '1px solid #D8D3CB', textDecoration: 'none',
  boxShadow: '0 1px 3px rgba(24,22,15,0.07)',
};
