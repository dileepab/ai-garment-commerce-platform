import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import prisma from '@/lib/prisma';
import { canScope, getBrandScopedWhere, getBrandScopeValues } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { getScopedConversationSenderIds } from '@/lib/conversation-scope';
import { isActiveOrderStatus, getOrderStageLabel } from '@/lib/order-status-display';
import {
  formatLkr,
  formatPct,
  summarizeAiMetrics,
  summarizeOrders,
  topSellingProducts,
} from '@/lib/analytics';
import {
  computeInventoryPlan,
  getVariantInventoryBrandScopedWhere,
  DEFAULT_REORDER_THRESHOLD,
} from '@/lib/inventory-planning';

export const dynamic = 'force-dynamic';

// ── Helpers ──────────────────────────────────────────────
function fmt(n: number) { return new Intl.NumberFormat('en-LK').format(n); }
function fmtDate(d: Date) {
  const now = new Date();
  const diff = Math.round((now.getTime() - d.getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return d.toLocaleDateString('en-LK', { month: 'short', day: 'numeric' });
}

function statusPillClass(status: string) {
  const s = status.toLowerCase();
  if (s === 'pending') return { bg: '#FFF0C2', color: '#7A5400' };
  if (s === 'confirmed') return { bg: '#D6DDE8', color: '#1E3452' };
  if (s === 'processing' || s === 'packing' || s === 'packed') return { bg: '#E8E0F5', color: '#4A2D7A' };
  if (s === 'dispatched' || s === 'shipped') return { bg: '#D4EDE0', color: '#1A5C3C' };
  if (s === 'delivered') return { bg: '#EDFAF4', color: '#1E6B45' };
  if (s === 'delivery_failed') return { bg: '#FCE2E2', color: '#8B2020' };
  if (s === 'returned') return { bg: '#F1E4D7', color: '#5C3A1A' };
  if (s === 'cancelled') return { bg: '#F5D8D8', color: '#701919' };
  return { bg: '#F2EFE9', color: '#6A635A' };
}

function batchStatusPill(status: string) {
  if (status === 'delayed') return { bg: '#F5D8D8', color: '#701919', label: 'Delayed' };
  if (status === 'completed') return { bg: '#D4EDE0', color: '#1A5C3C', label: 'Finished' };
  if (status === 'planned') return { bg: '#D6DDE8', color: '#1E3452', label: 'Planned' };
  return { bg: '#D4EDE0', color: '#1A5C3C', label: 'Active' };
}

// ── Icons ────────────────────────────────────────────────
const ShirtIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z" /></svg>;
const BoxIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>;
const AlertIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
const MsgIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
const FactoryIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" /></svg>;
const UsersIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>;
const ZapIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;

export default async function Dashboard() {
  const scope = await requirePagePermission('dashboard:view');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last30 = new Date(today); last30.setDate(last30.getDate() - 29);
  const brandWhere = getBrandScopedWhere(scope);
  const brandValues = getBrandScopeValues(scope);
  const variantInventoryWhere = getVariantInventoryBrandScopedWhere(brandValues);
  const canViewAnalytics = canScope(scope, 'analytics:view');
  const scopedSenderIds = await getScopedConversationSenderIds(scope);
  const todayChatWhere = {
    createdAt: { gte: today },
    ...(scopedSenderIds ? { senderId: { in: scopedSenderIds } } : {}),
  };
  const last30ChatWhere = {
    createdAt: { gte: last30 },
    ...(scopedSenderIds ? { senderId: { in: scopedSenderIds } } : {}),
  };

  const [
    allOrders,
    // Variant-level low-stock count (replaces product-level Inventory count)
    lowStockVariantCount,
    openEscalationCount,
    activeBatchCount,
    recentOrders,
    // Critical/low variants for planning sections
    criticalLowVariants,
    recentEscalations,
    activeBatches,
    operators,
    todayMessages,
    todayEscalations,
    todayOrders,
    last30Orders,
    last30Items,
    last30Messages,
    last30Escalations,
    // Order items with variant ids for slow-moving detection (all time for dead-stock)
    allVariantSales,
  ] = await Promise.all([
    prisma.order.findMany({ where: brandWhere, select: { id: true, orderStatus: true, totalAmount: true, createdAt: true, customerId: true } }),

    // Count variant-level SKUs that are at or below the default reorder threshold
    prisma.variantInventory.count({
      where: { ...variantInventoryWhere, availableQty: { lte: DEFAULT_REORDER_THRESHOLD } },
    }),

    prisma.supportEscalation.count({ where: { ...brandWhere, status: { not: 'resolved' } } }),
    prisma.productionBatch.count({ where: { ...brandWhere, status: { notIn: ['completed', 'cancelled'] } } }),

    // Recent orders for pipeline
    prisma.order.findMany({
      where: brandWhere,
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: { customer: true, orderItems: { include: { product: true }, take: 1 } },
    }),

    // Critical and low variants for planning (ordered by urgency: out-of-stock first, then critical, then low)
    prisma.variantInventory.findMany({
      where: { ...variantInventoryWhere, availableQty: { lte: DEFAULT_REORDER_THRESHOLD } },
      orderBy: { availableQty: 'asc' },
      take: 10,
      include: {
        variant: {
          include: { product: { select: { id: true, name: true, brand: true } } },
        },
      },
    }),

    // Recent open escalations
    prisma.supportEscalation.findMany({
      where: { ...brandWhere, status: { not: 'resolved' } },
      take: 4,
      orderBy: { updatedAt: 'desc' },
      include: { customer: true },
    }),

    // Active production batches
    prisma.productionBatch.findMany({
      where: { ...brandWhere, status: { notIn: ['completed', 'cancelled'] } },
      take: 4,
      orderBy: { createdAt: 'desc' },
    }),

    // Operators with outputs
    prisma.operator.findMany({
      take: 4,
      orderBy: { id: 'asc' },
      include: { operatorOutputs: { take: 10, orderBy: { date: 'desc' } } },
    }),

    // AI: messages today
    prisma.chatMessage.count({ where: todayChatWhere }),

    // Escalations created today
    prisma.supportEscalation.count({ where: { ...brandWhere, createdAt: { gte: today } } }),

    // Orders today (for revenue today)
    prisma.order.findMany({
      where: { ...brandWhere, createdAt: { gte: today } },
      select: { id: true, orderStatus: true, totalAmount: true, createdAt: true, customerId: true },
    }),

    // Orders last 30 days for revenue summary
    prisma.order.findMany({
      where: { ...brandWhere, createdAt: { gte: last30 } },
      select: { id: true, orderStatus: true, totalAmount: true, createdAt: true, customerId: true },
    }),

    // Order items last 30 days for top sellers
    prisma.orderItem.findMany({
      where: { order: { ...brandWhere, createdAt: { gte: last30 } } },
      select: {
        productId: true, quantity: true, price: true, orderId: true,
        product: { select: { id: true, name: true, brand: true } },
        order: { select: { createdAt: true, orderStatus: true } },
      },
    }),

    // AI messages last 30 days
    prisma.chatMessage.findMany({
      where: last30ChatWhere,
      select: { senderId: true, channel: true, role: true, createdAt: true },
    }),

    // Escalations last 30 days
    prisma.supportEscalation.findMany({
      where: { ...brandWhere, createdAt: { gte: last30 } },
      select: { status: true, createdAt: true, resolvedAt: true, customerId: true },
    }),

    // All variant-level sales (for slow/dead-stock detection)
    prisma.orderItem.findMany({
      where: { variantId: { not: null }, order: brandWhere },
      select: {
        variantId: true, productId: true, quantity: true,
        order: { select: { createdAt: true, orderStatus: true } },
      },
    }),
  ]);

  const openOrders = allOrders.filter((o) => isActiveOrderStatus(o.orderStatus));

  // Pipeline counts
  const pipeline = [
    { label: 'Pending', color: '#E8C840', statuses: ['pending'] },
    { label: 'Confirmed', color: '#4A7AA8', statuses: ['confirmed'] },
    { label: 'Packing', color: '#8B5CF6', statuses: ['processing', 'packing', 'packed'] },
    { label: 'Dispatched', color: '#38A169', statuses: ['dispatched', 'shipped'] },
    { label: 'Delivered', color: '#1E6B45', statuses: ['delivered'] },
    { label: 'Issues', color: '#C04A4A', statuses: ['delivery_failed', 'returned'] },
  ].map((p) => ({
    ...p,
    count: allOrders.filter((o) => p.statuses.includes(o.orderStatus.toLowerCase())).length,
  }));
  const pipelineTotal = pipeline.reduce((s, p) => s + p.count, 0) || 1;

  // Revenue summaries
  const revenueToday = summarizeOrders(todayOrders);
  const revenue30 = summarizeOrders(last30Orders);
  const topProducts = topSellingProducts(last30Items, 5);

  // AI metrics over last 30 days
  const ai30 = summarizeAiMetrics({ messages: last30Messages, escalations: last30Escalations, convertedConversationCount: 0 });

  // Needs attention alerts
  const delayedBatches = activeBatches.filter((b) => b.status === 'delayed');

  // Build variant plan items from the fetched critical/low variants for planning display
  const planVariants = criticalLowVariants.map((vi) => ({
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

  const criticalVariantsForAlert = plan.topRestockPriorities.filter(
    (i) => i.stockStatus === 'critical' || i.stockStatus === 'out-of-stock',
  );

  const avatarColors = ['#C4622D', '#1E3452', '#1E6B45', '#9B6B00', '#8B2020'];

  return (
    <main className="main">
      {/* ── Topbar ───────────────────────────────────────── */}
      <PageHeader
        title="Business Overview"
        subtitle={
          <>
            {new Date().toLocaleDateString('en-LK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}All systems operational
          </>
        }
        actions={
          <>
            {canViewAnalytics && <Link href="/analytics" style={btnSecondary}>Analytics</Link>}
            <Link href="/orders" style={btnSecondary}>View Orders</Link>
            <Link href="/products" style={btnPrimary}>Add Product</Link>
          </>
        }
      />

      <div className="content">
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* ── KPI Grid ─────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Revenue Today', value: formatLkr(revenueToday.netRevenue), note: `${fmt(revenueToday.paidOrderCount)} paid orders`, iconBg: '#D4EDE0', iconColor: '#1E6B45', Icon: ShirtIcon },
              { label: 'Revenue · 30d', value: formatLkr(revenue30.netRevenue), note: `AOV ${formatLkr(revenue30.averageOrderValue)}`, iconBg: '#F2E4D8', iconColor: '#C4622D', Icon: BoxIcon },
              { label: 'Open Orders', value: fmt(openOrders.length), note: `${allOrders.length} total`, iconBg: '#D6DDE8', iconColor: '#1E3452', Icon: BoxIcon },
              { label: 'Low Stock Variants', value: fmt(lowStockVariantCount), note: plan.needsRestock > 0 ? `${plan.needsRestock} critical/out` : 'Need reorder', iconBg: '#FFF0C2', iconColor: '#9B6B00', Icon: AlertIcon },
              { label: 'Escalated Cases', value: fmt(openEscalationCount), note: 'Open support cases', iconBg: '#F5D8D8', iconColor: '#8B2020', Icon: MsgIcon },
              { label: 'Active Batches', value: fmt(activeBatchCount), note: `${delayedBatches.length} delayed`, iconBg: '#D4EDE0', iconColor: '#1E6B45', Icon: FactoryIcon },
            ].map((k, i) => (
              <div key={i} style={kpiCard}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: k.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10, color: k.iconColor }}>
                  <k.Icon />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#9C9188', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em', color: '#18160F', lineHeight: 1, marginBottom: 6 }}>{k.value}</div>
                <div style={{ fontSize: 11, color: '#9C9188' }}>{k.note}</div>
              </div>
            ))}
          </div>

          {/* ── AI Activity ───────────────────────────────── */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={cardHeader}>
              <span style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#C4622D' }}><ZapIcon /></span>
                AI Performance · Last 30 days
              </span>
              {canViewAnalytics && (
                <Link href="/analytics" style={{ fontSize: 11, fontWeight: 600, color: '#C4622D', textDecoration: 'none' }}>
                  Full report →
                </Link>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0 }}>
              {[
                { val: formatPct(ai30.responseRate), label: 'Response Rate', note: `${fmt(ai30.assistantMessages)} replies`, good: ai30.responseRate >= 0.9, bad: false },
                { val: formatPct(ai30.escalationRate), label: 'Escalation Rate', note: `${fmt(ai30.escalationCount)} cases`, good: ai30.escalationRate < 0.1, bad: ai30.escalationRate >= 0.25 },
                { val: formatPct(ai30.resolutionRate), label: 'Resolution Rate', note: `${fmt(ai30.resolvedCount)} resolved`, good: ai30.resolutionRate >= 0.8, bad: false },
                { val: fmt(todayMessages), label: 'Messages Today', note: `${fmt(ai30.totalMessages)} this month`, good: false, bad: false },
                { val: fmt(todayEscalations), label: 'Handed Off Today', note: 'New escalations today', good: todayEscalations === 0, bad: false },
                { val: fmt(openEscalationCount), label: 'Open Cases', note: 'Awaiting follow-up', good: openEscalationCount === 0, bad: openEscalationCount > 5 },
              ].map((m, i) => (
                <div key={i} style={{ padding: '14px 16px', borderLeft: i > 0 ? '1px solid #EAE6E0' : 'none' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 3, color: m.bad ? '#8B2020' : m.good ? '#1E6B45' : '#18160F' }}>
                    {m.val}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6A635A', marginBottom: 2 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: '#9C9188' }}>{m.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Top Sellers · 30 days ─────────────────────── */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={cardHeader}>
              <span style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#C4622D' }}><ShirtIcon /></span>
                Top Sellers · Last 30 days
              </span>
              {canViewAnalytics && <Link href="/analytics" style={cardAction}>Full report →</Link>}
            </div>
            <div style={{ padding: '0 16px' }}>
              {topProducts.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: '#9C9188', fontSize: 13 }}>
                  No sales recorded in the last 30 days.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Product', 'Brand', 'Units Sold', 'Revenue', 'Orders'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p, idx) => (
                      <tr key={p.productId} style={{ borderBottom: idx < topProducts.length - 1 ? '1px solid #EAE6E0' : 'none' }}>
                        <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                        <td style={{ ...td, color: '#6A635A' }}>{p.brand ?? '—'}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{fmt(p.unitsSold)}</td>
                        <td style={{ ...td, color: '#1E6B45', fontWeight: 600 }}>{formatLkr(p.revenue)}</td>
                        <td style={{ ...td, color: '#6A635A' }}>{fmt(p.orderCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── Needs Attention ───────────────────────────── */}
          {(criticalVariantsForAlert.length > 0 || openEscalationCount > 0 || delayedBatches.length > 0) && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={cardHeader}>
                <span style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#8B2020' }}><AlertIcon /></span>
                  Needs Attention Today
                </span>
              </div>
              <div style={{ padding: '10px 16px' }}>
                {delayedBatches.length > 0 && (
                  <div style={alertRow}>
                    <div style={{ ...alertDot, background: '#8B2020' }} />
                    <div style={{ flex: 1 }}>
                      <div style={alertText}>{delayedBatches.length} production batch{delayedBatches.length > 1 ? 'es' : ''} delayed — review production floor</div>
                      <div style={alertSub}>{delayedBatches.map(b => `Batch #${b.id}`).join(', ')}</div>
                    </div>
                    <Link href="/production" style={alertAction}>Review batches →</Link>
                  </div>
                )}
                {criticalVariantsForAlert.length > 0 && (
                  <div style={alertRow}>
                    <div style={{ ...alertDot, background: '#9B6B00' }} />
                    <div style={{ flex: 1 }}>
                      <div style={alertText}>{criticalVariantsForAlert.length} variant{criticalVariantsForAlert.length > 1 ? 's' : ''} at critical or zero stock — reorder soon</div>
                      <div style={alertSub}>
                        {criticalVariantsForAlert.slice(0, 3).map(i => `${i.productName} (${i.size}/${i.color})`).join(' · ')}
                        {criticalVariantsForAlert.length > 3 ? ` + ${criticalVariantsForAlert.length - 3} more` : ''}
                      </div>
                    </div>
                    <Link href="/products" style={alertAction}>Reorder now →</Link>
                  </div>
                )}
                {openEscalationCount > 0 && (
                  <div style={{ ...alertRow, borderBottom: 'none', paddingBottom: 0 }}>
                    <div style={{ ...alertDot, background: '#8B2020' }} />
                    <div style={{ flex: 1 }}>
                      <div style={alertText}>{openEscalationCount} support case{openEscalationCount > 1 ? 's' : ''} waiting for follow-up</div>
                      <div style={alertSub}>Customer escalations via Messenger and Instagram</div>
                    </div>
                    <Link href="/support" style={alertAction}>Open inbox →</Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Order Pipeline + Support ───────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

            {/* Order Pipeline */}
            <div style={card}>
              <div style={cardHeader}>
                <span style={cardTitle}>Today&apos;s Order Pipeline</span>
                <Link href="/orders" style={cardAction}>View all {openOrders.length} →</Link>
              </div>
              <div style={{ padding: '12px 16px 0' }}>
                {/* Bar */}
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                  {pipeline.map((p, i) => (
                    p.count > 0 && <div key={i} style={{ flex: p.count / pipelineTotal, background: p.color }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  {pipeline.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6A635A' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 99, background: p.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{p.count}</span>
                      <span style={{ color: '#9C9188' }}>{p.label}</span>
                    </div>
                  ))}
                </div>
                {/* Recent orders table */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Order', 'Customer', 'Item', 'Status', 'When'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((o) => {
                      const pill = statusPillClass(o.orderStatus);
                      const leadItem = o.orderItems[0];
                      return (
                        <tr key={o.id} style={{ borderBottom: '1px solid #EAE6E0' }}>
                          <td style={td}><span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: '#9C9188' }}>#{o.id}</span></td>
                          <td style={{ ...td, fontWeight: 600 }}>{o.customer?.name || `Customer ${o.customerId}`}</td>
                          <td style={td}><span style={{ fontSize: 11, color: '#6A635A' }}>{leadItem?.product?.name || '—'}</span></td>
                          <td style={td}>
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: pill.bg, color: pill.color }}>
                              {getOrderStageLabel(o.orderStatus)}
                            </span>
                          </td>
                          <td style={{ ...td, color: '#9C9188', fontSize: 11 }}>{fmtDate(o.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Support Escalations */}
            <div style={card}>
              <div style={cardHeader}>
                <span style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#8B2020' }}><MsgIcon /></span>
                  Recent Support Escalations
                </span>
                <Link href="/support" style={cardAction}>Open inbox →</Link>
              </div>
              <div style={{ padding: '0 16px' }}>
                {recentEscalations.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#9C9188', fontSize: 13 }}>No open escalations</div>
                ) : recentEscalations.map((e, i) => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: i < recentEscalations.length - 1 ? '1px solid #EAE6E0' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#18160F' }}>
                          {e.contactName || e.customer?.name || `Case #${e.id}`}
                        </span>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', padding: '2px 7px',
                          borderRadius: 9999, fontSize: 10, fontWeight: 700,
                          background: e.channel === 'instagram' ? '#C13584' : '#0866FF',
                          color: '#fff',
                        }}>
                          {e.channel === 'instagram' ? 'Instagram' : 'Messenger'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6A635A', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {e.summary || e.latestCustomerMessage || 'No summary available'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: e.status === 'open' ? '#F5D8D8' : '#FFF0C2', color: e.status === 'open' ? '#701919' : '#7A5400' }}>
                        {e.status === 'open' ? 'Escalated' : 'In Progress'}
                      </span>
                      <span style={{ fontSize: 10, color: '#9C9188' }}>{fmtDate(e.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Restock Priorities ────────────────────────── */}
          {plan.topRestockPriorities.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={cardHeader}>
                <span style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#9B6B00' }}><AlertIcon /></span>
                  Restock Priorities · Variant Level
                </span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#9C9188' }}>
                    {plan.outOfStock > 0 && <span style={{ color: '#8B2020', fontWeight: 700 }}>{plan.outOfStock} out · </span>}
                    {plan.critical > 0 && <span style={{ color: '#8B2020', fontWeight: 700 }}>{plan.critical} critical · </span>}
                    {plan.low > 0 && <span style={{ color: '#9B6B00', fontWeight: 600 }}>{plan.low} low</span>}
                  </span>
                  <Link href="/products" style={cardAction}>Manage all →</Link>
                </div>
              </div>
              <div style={{ padding: '0 16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Product', 'Brand', 'Variant', 'Available', 'Reserved', 'Reorder At', 'Suggest', 'Status'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.topRestockPriorities.map((item, idx) => {
                      const isCrit = item.stockStatus === 'critical' || item.stockStatus === 'out-of-stock';
                      const pillBg = item.stockStatus === 'out-of-stock' ? '#F5D8D8' : isCrit ? '#FCE2E2' : '#FFF0C2';
                      const pillColor = item.stockStatus === 'out-of-stock' ? '#701919' : isCrit ? '#8B2020' : '#7A5400';
                      const pillLabel = item.stockStatus === 'out-of-stock' ? 'Out of Stock' : isCrit ? 'Critical' : 'Low Stock';
                      return (
                        <tr key={item.variantId} style={{ borderBottom: idx < plan.topRestockPriorities.length - 1 ? '1px solid #EAE6E0' : 'none' }}>
                          <td style={{ ...td, fontWeight: 600 }}>{item.productName}</td>
                          <td style={{ ...td, color: '#6A635A' }}>{item.brand}</td>
                          <td style={td}>
                            <span style={varChip}>{item.size}</span>
                            <span style={varChip}>{item.color}</span>
                          </td>
                          <td style={{ ...td, fontWeight: 700, color: isCrit ? '#8B2020' : '#9B6B00' }}>{item.availableQty}</td>
                          <td style={{ ...td, color: '#9C9188' }}>{item.reservedQty}</td>
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
            </div>
          )}

          {/* ── Production + Operators ────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Production Health */}
            <div style={card}>
              <div style={cardHeader}>
                <span style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#1E3452' }}><FactoryIcon /></span>
                  Production Health
                </span>
                <Link href="/production" style={cardAction}>All batches →</Link>
              </div>
              <div style={{ padding: '0 16px' }}>
                {activeBatches.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#9C9188', fontSize: 13 }}>No active batches</div>
                ) : activeBatches.map((b, i) => {
                  const pct = b.plannedQty > 0 ? Math.min(100, Math.round((b.finishedQty / b.plannedQty) * 100)) : 0;
                  const pill = batchStatusPill(b.status);
                  const isDelayed = b.status === 'delayed';
                  return (
                    <div key={b.id} style={{ padding: '10px 0', borderBottom: i < activeBatches.length - 1 ? '1px solid #EAE6E0' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#18160F' }}>
                              {b.brand || 'Unnamed batch'} {b.style ? `— ${b.style}` : ''}
                            </span>
                            <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: pill.bg, color: pill.color }}>{pill.label}</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#9C9188', fontFamily: 'var(--font-mono, monospace)' }}>
                            Batch #{b.id} · {b.finishedQty}/{b.plannedQty} units · {b.rejectedQty} rejected
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: isDelayed ? '#8B2020' : '#1E6B45' }}>{pct}%</div>
                          <div style={{ fontSize: 10, color: '#9C9188' }}>complete</div>
                        </div>
                      </div>
                      <div style={{ background: '#EAE6E0', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: isDelayed ? '#9B6B00' : '#C4622D' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Operators */}
            <div style={card}>
              <div style={cardHeader}>
                <span style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#1E3452' }}><UsersIcon /></span>
                  Operator Performance
                </span>
                <Link href="/operators" style={cardAction}>Full report →</Link>
              </div>
              <div style={{ padding: '0 16px' }}>
                {operators.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#9C9188', fontSize: 13 }}>No operators registered</div>
                ) : operators.map((op, i) => {
                  const totalOutput = op.operatorOutputs.reduce((s, o) => s + o.outputQty, 0);
                  const eff = op.efficiency ?? 0;
                  const effColor = eff >= 90 ? '#1E6B45' : eff >= 75 ? '#9B6B00' : '#8B2020';
                  const initials = op.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                  return (
                    <div key={op.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < operators.length - 1 ? '1px solid #EAE6E0' : 'none' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarColors[i % avatarColors.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#18160F' }}>{op.name}</div>
                        <div style={{ fontSize: 11, color: '#9C9188' }}>{op.skill || 'Unassigned'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#18160F', letterSpacing: '-0.02em' }}>{totalOutput}</div>
                          <div style={{ fontSize: 10, color: '#9C9188' }}>units</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: effColor, letterSpacing: '-0.02em' }}>{eff}%</div>
                          <div style={{ fontSize: 10, color: '#9C9188' }}>efficiency</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}

// ── Style constants ──────────────────────────────────────────
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
const kpiCard: React.CSSProperties = {
  ...card, padding: 16, cursor: 'pointer',
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
const alertRow: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: '10px 0', borderBottom: '1px solid #EAE6E0',
};
const alertDot: React.CSSProperties = {
  width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 5,
};
const alertText: React.CSSProperties = {
  fontSize: 13, color: '#18160F', lineHeight: 1.4,
};
const alertSub: React.CSSProperties = {
  fontSize: 11, color: '#9C9188', marginTop: 2,
};
const alertAction: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#C4622D',
  whiteSpace: 'nowrap', marginTop: 2, textDecoration: 'none', flexShrink: 0,
};
const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 13px', borderRadius: 7, fontSize: 12, fontWeight: 600,
  background: '#C4622D', color: '#fff', textDecoration: 'none',
};
const btnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 13px', borderRadius: 7, fontSize: 12, fontWeight: 600,
  background: '#fff', color: '#18160F', border: '1px solid #D8D3CB',
  boxShadow: '0 1px 3px rgba(24,22,15,0.07)', textDecoration: 'none',
};
