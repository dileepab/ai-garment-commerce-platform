import Link from 'next/link';
import prisma from '@/lib/prisma';
import {
  getBrandScopedWhere,
  getProductBrandScopedWhere,
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

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ range?: string }>;

function fmt(n: number) { return new Intl.NumberFormat('en-LK').format(n); }

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await requirePagePermission('analytics:view');
  const { range } = await searchParams;
  const { preset, from, to } = resolveDateRange(range);

  const brandWhere = getBrandScopedWhere(scope);
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
        order:   { select: { createdAt: true, orderStatus: true } },
      },
    }),
    prisma.inventory.findMany({
      where: getProductBrandScopedWhere(scope),
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

  const rangeLabel = DATE_RANGE_PRESETS.find((r) => r.id === preset)?.label ?? '';
  const rangeSubtitle = from
    ? `${from.toLocaleDateString('en-LK', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('en-LK', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Across all recorded data';

  return (
    <main style={{ minHeight: '100vh', background: '#F7F5F2' }}>
      {/* ── Topbar ───────────────────────────────────────── */}
      <div style={topbar}>
        <div style={{ flex: 1 }}>
          <div style={topTitle}>Analytics &amp; Reporting</div>
          <div style={topSubtitle}>{rangeLabel} · {rangeSubtitle}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
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
      </div>

      <div style={{ padding: '24px 28px 48px', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── Headline KPIs ────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <KpiCard label="Net Revenue"    value={formatLkr(revenue.netRevenue)}      note={`${fmt(revenue.paidOrderCount)} paid orders`} accent="#1E6B45" />
          <KpiCard label="Avg Order Value" value={formatLkr(revenue.averageOrderValue)} note="Excludes cancellations" accent="#1E3452" />
          <KpiCard label="Customers"       value={fmt(revenue.uniqueCustomerCount)}    note={`${fmt(revenue.repeatOrderCount)} repeat orders`} accent="#C4622D" />
          <KpiCard label="Cancellations"   value={fmt(revenue.cancelledCount)}        note={`${formatLkr(revenue.cancelledRevenue)} lost`} accent={revenue.cancelledCount > 0 ? '#8B2020' : '#9C9188'} />
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, marginBottom: 16 }}>
          {/* Order status */}
          <div style={card}>
            <div style={cardHeader}>
              <span style={cardTitle}>Order Status Mix</span>
              <Link href="/orders" style={cardAction}>Manage orders →</Link>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {[
                { label: 'Pending',   value: status.pending,   color: '#E8C840' },
                { label: 'Confirmed', value: status.confirmed, color: '#4A7AA8' },
                { label: 'Packing',   value: status.packing,   color: '#8B5CF6' },
                { label: 'Shipped',   value: status.shipped,   color: '#38A169' },
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <Metric val={fmt(ai.totalMessages)}       label="Messages"          note={`${fmt(ai.uniqueConversations)} convos`} />
            <Metric val={formatPct(ai.responseRate)}  label="Response Rate"     note="Replied vs received" good={ai.responseRate >= 0.9} />
            <Metric val={formatPct(ai.conversionRate)} label="Conversion Rate"   note={`${fmt(ai.conversionsFromCustomers)} converted`} good={ai.conversionRate > 0} />
            <Metric val={formatPct(ai.escalationRate)} label="Escalation Rate"   note={`${fmt(ai.escalationCount)} cases`} good={ai.escalationRate < 0.1} bad={ai.escalationRate >= 0.25} />
            <Metric val={fmt(ai.openCount)}           label="Open Cases"        note="Need follow-up" good={ai.openCount === 0} bad={ai.openCount > 5} />
            <Metric val={formatPct(ai.resolutionRate)} label="Resolution Rate"   note={`${fmt(ai.resolvedCount)} resolved`} good={ai.resolutionRate >= 0.8} />
          </div>
        </div>

        {/* ── Stock + production ───────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={card}>
            <div style={cardHeader}>
              <span style={cardTitle}>Stock Health</span>
              <Link href="/products" style={cardAction}>Reorder →</Link>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
                <MiniStat val={fmt(stock.outOfStock)} label="Out of stock" color="#8B2020" />
                <MiniStat val={fmt(stock.critical)}   label="Critical (≤3)" color="#8B2020" />
                <MiniStat val={fmt(stock.low)}        label="Low (≤10)"     color="#9B6B00" />
                <MiniStat val={fmt(stock.healthy)}    label="Healthy"        color="#1E6B45" />
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
                <MiniStat val={fmt(production.active)}    label="Active batches"   color="#1E3452" />
                <MiniStat val={fmt(production.delayed)}   label="Delayed"          color={production.delayed > 0 ? '#8B2020' : '#9C9188'} />
                <MiniStat val={fmt(production.completed)} label="Completed"        color="#1E6B45" />
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

        {/* ── Footer context ───────────────────────────────── */}
        <div style={{ fontSize: 11, color: '#9C9188', textAlign: 'center', padding: '10px 0' }}>
          {fmt(productCount)} products in catalog · {fmt(activeOrderCount)} active orders overall
        </div>
      </div>
    </main>
  );
}

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
  color: '#9C9188', padding: '10px 12px 8px', textAlign: 'left', borderBottom: '1px solid #EAE6E0',
};
const td: React.CSSProperties = {
  fontSize: 13, color: '#18160F', padding: '9px 12px',
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
