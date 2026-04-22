import Link from 'next/link';
import prisma from '@/lib/prisma';
import { isActiveOrderStatus } from '@/lib/order-status-display';
import {
  buildSupportContactLine,
  hasDirectSupportContactConfigured,
} from '@/lib/customer-support';
import { getRuntimeWarnings } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

const DASHBOARD_LINKS = [
  {
    href: '/products',
    title: 'Products & Inventory',
    description: 'Review catalog coverage, color and size variants, and live stock movement.',
    accentClass: 'app-chip-accent',
  },
  {
    href: '/orders',
    title: 'Order Management',
    description: 'Track active orders with item variants, customer details, and quantities in one place.',
    accentClass: 'app-chip-warning',
  },
  {
    href: '/production',
    title: 'Production Batches',
    description: 'Monitor planned output, batch status, and progress across styles.',
    accentClass: 'app-chip-neutral',
  },
  {
    href: '/operators',
    title: 'Operator Performance',
    description: 'See operator output, efficiency, and active skill assignments clearly.',
    accentClass: 'app-chip-accent',
  },
  {
    href: '/support',
    title: 'Support Inbox',
    description: 'Review escalated customer conversations, complaint summaries, and handoff context in one place.',
    accentClass: 'app-chip-danger',
  },
];

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat('en-LK').format(value);
}

export default async function Dashboard() {
  const supportContactConfigured = hasDirectSupportContactConfigured();
  const supportContactLine = buildSupportContactLine();
  const runtimeWarnings = getRuntimeWarnings();
  const [productCount, orders, operatorCount, batchCount, lowStockCount, openUnits, openEscalationCount] =
    await Promise.all([
      prisma.product.count(),
      prisma.order.findMany({
        select: {
          orderStatus: true,
        },
      }),
      prisma.operator.count(),
      prisma.productionBatch.count(),
      prisma.inventory.count({
        where: {
          availableQty: {
            lte: 3,
          },
        },
      }),
      prisma.orderItem.aggregate({
        where: {
          order: {
            orderStatus: {
              notIn: ['cancelled', 'delivered'],
            },
          },
        },
        _sum: {
          quantity: true,
        },
      }),
      prisma.supportEscalation.count({
        where: {
          status: {
            not: 'resolved',
          },
        },
      }),
    ]);

  const openOrdersCount = orders.filter((order) => isActiveOrderStatus(order.orderStatus)).length;

  const metrics = [
    { label: 'Products', value: formatMetricValue(productCount), note: 'Active catalog entries' },
    { label: 'Open Orders', value: formatMetricValue(openOrdersCount), note: 'Not delivered or cancelled' },
    { label: 'Units On Order', value: formatMetricValue(openUnits._sum.quantity || 0), note: 'Across active orders' },
    { label: 'Operators', value: formatMetricValue(operatorCount), note: 'Registered production staff' },
    { label: 'Batches', value: formatMetricValue(batchCount), note: 'Production records' },
    { label: 'Low Stock', value: formatMetricValue(lowStockCount), note: 'Items with 3 or fewer left' },
    { label: 'Support Cases', value: formatMetricValue(openEscalationCount), note: 'Open escalations waiting for follow-up' },
  ];

  return (
    <main className="app-shell">
      <div className="app-container space-y-8">
        <section className="app-panel overflow-hidden px-6 py-8 md:px-10 md:py-10">
          <div className="grid gap-8 lg:grid-cols-[1.35fr_0.85fr]">
            <div>
              <p className="app-kicker">Garment Operations Hub</p>
              <h1 className="app-title mt-3 max-w-2xl">
                A clearer control room for catalog, orders, production, and AI-driven selling.
              </h1>
              <p className="app-subtitle">
                This dashboard now uses stronger contrast, warmer surfaces, and cleaner navigation so day-to-day
                decisions are easier to read quickly. Use the sections below to jump directly into the area you need.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/orders" className="app-link bg-[color:var(--accent)] text-white hover:text-white">
                  Review Orders
                </Link>
                <Link href="/products" className="app-link">
                  Check Inventory
                </Link>
              </div>
            </div>

            <div className="rounded-[26px] border border-[color:var(--border)] bg-[linear-gradient(160deg,rgba(15,118,110,0.11),rgba(255,255,255,0.9)_46%,rgba(255,239,199,0.7))] p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--accent-strong)]">
                    AI Conversation Engine
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    Customer support, order capture, complaint handoff, and size-chart routing are live and ready for testing.
                  </p>
                </div>
                <span className="app-chip app-chip-accent">Online</span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                    Focus
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">Readable order detail</p>
                </div>
                <div className="rounded-2xl bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                    Next
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">Human handoff and support follow-up</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          className={`rounded-[26px] border px-6 py-5 ${
            supportContactConfigured
              ? 'border-emerald-200 bg-emerald-50/80'
              : 'border-amber-200 bg-amber-50/90'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
                Support Handoff
              </p>
              <p className="mt-3 text-base font-semibold text-slate-900">
                {supportContactConfigured
                  ? 'Direct support contact is configured for customer handoff.'
                  : 'Direct support phone or WhatsApp is not configured yet.'}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{supportContactLine}</p>
              {!supportContactConfigured ? (
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Add `STORE_SUPPORT_PHONE` and/or `STORE_SUPPORT_WHATSAPP` in `.env` to show a real contact number in bot replies.
                </p>
              ) : null}
            </div>
            <span className={`app-chip ${supportContactConfigured ? 'app-chip-accent' : 'app-chip-warning'}`}>
              {supportContactConfigured ? 'Configured' : 'Needs Setup'}
            </span>
          </div>
        </section>

        {runtimeWarnings.length > 0 ? (
          <section className="rounded-[26px] border border-amber-200 bg-amber-50/90 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--warning)]">
                  Runtime Notes
                </p>
                <p className="mt-3 text-base font-semibold text-slate-900">
                  A few configuration items still need attention before production traffic.
                </p>
                <div className="mt-4 space-y-3">
                  {runtimeWarnings.map((warning) => (
                    <div key={warning.key} className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{warning.key}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{warning.message}</p>
                    </div>
                  ))}
                </div>
              </div>
              <span className="app-chip app-chip-warning">{runtimeWarnings.length} note(s)</span>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="app-metric">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
                {metric.label}
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{metric.value}</p>
              <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">{metric.note}</p>
            </div>
          ))}
        </section>

        <section className="space-y-4">
          <div className="app-header mb-0">
            <div>
              <p className="app-kicker">Workspace</p>
              <h2 className="app-title text-2xl md:text-3xl">Navigate by workflow</h2>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {DASHBOARD_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="app-card block">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className={`app-chip ${item.accentClass}`}>Open module</span>
                    <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{item.title}</h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
                    View
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-[color:var(--foreground-soft)]">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
