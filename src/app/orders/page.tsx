import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getDeliveryChargeForAddress } from '@/lib/order-draft';
import { getOrderStageLabel, getOrderStageNote, isActiveOrderStatus } from '@/lib/order-status-display';

export const dynamic = 'force-dynamic';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-LK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(value);
}

function getStatusClass(status: string): string {
  switch (status.trim().toLowerCase()) {
    case 'pending':
    case 'confirmed':
    case 'processing':
      return 'app-chip app-chip-accent';
    case 'packed':
    case 'dispatched':
      return 'app-chip app-chip-warning';
    case 'delivered':
      return 'app-chip app-chip-neutral';
    case 'cancelled':
      return 'app-chip app-chip-danger';
    default:
      return 'app-chip app-chip-neutral';
  }
}

function formatVariantLabel(label: string, value?: string | null): string | null {
  return value ? `${label}: ${value}` : null;
}

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    include: {
      customer: true,
      orderItems: {
        include: {
          product: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  const activeOrders = orders.filter((order) => isActiveOrderStatus(order.orderStatus));

  return (
    <main className="app-shell">
      <div className="app-container space-y-6">
        <div className="app-header">
          <div>
            <p className="app-kicker">Orders</p>
            <h1 className="app-title">Active orders with full item detail</h1>
            <p className="app-subtitle">
              Each order now surfaces product variants and quantities clearly, so you can review exactly what the
              customer asked for without opening the database.
            </p>
          </div>
          <Link href="/" className="app-link">
            Back to Dashboard
          </Link>
        </div>

        {activeOrders.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">No active orders found</h2>
            <p className="mt-3 text-sm text-[color:var(--foreground-soft)]">
              New confirmed orders will appear here with variant and quantity details.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 lg:grid-cols-2">
            {activeOrders.map((order) => {
              const totalUnits = order.orderItems.reduce((sum, item) => sum + item.quantity, 0);
              const deliveryCharge = getDeliveryChargeForAddress(order.deliveryAddress || '');
              const grandTotal = order.totalAmount + deliveryCharge;

              return (
                <article key={order.id} className="app-card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Order #{order.id}</h2>
                        <span className={getStatusClass(order.orderStatus)}>{getOrderStageLabel(order.orderStatus)}</span>
                      </div>
                      <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
                        Placed on {formatDate(order.createdAt)}
                      </p>
                      <p className="mt-2 text-sm text-slate-700">{getOrderStageNote(order.orderStatus)}</p>
                    </div>

                    <div className="rounded-2xl bg-[color:var(--background-strong)] px-4 py-3 text-right">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Order total
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(grandTotal)}</p>
                      <p className="mt-1 text-xs text-[color:var(--foreground-soft)]">
                        Includes delivery {formatCurrency(deliveryCharge)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Customer
                      </p>
                      <p className="mt-2 font-semibold text-slate-900">{order.customer?.name || `ID ${order.customerId}`}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Quantity
                      </p>
                      <p className="mt-2 font-semibold text-slate-900">{totalUnits} item(s)</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Payment
                      </p>
                      <p className="mt-2 font-semibold text-slate-900">{order.paymentMethod || 'COD'}</p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-[22px] border border-[color:var(--border)] bg-white/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground-soft)]">
                      Delivery
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-800">{order.deliveryAddress || 'Not provided'}</p>
                  </div>

                  <div className="mt-6 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground-soft)]">
                      Items
                    </p>
                    {order.orderItems.map((item) => {
                      const variants = [
                        formatVariantLabel('Size', item.size),
                        formatVariantLabel('Color', item.color),
                      ].filter(Boolean);

                      return (
                        <div
                          key={item.id}
                          className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--background-strong)] p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p className="text-lg font-semibold text-slate-900">{item.product.name}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="app-chip app-chip-warning">Qty: {item.quantity}</span>
                                {variants.map((variant) => (
                                  <span key={variant} className="app-chip app-chip-neutral">
                                    {variant}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <p className="text-sm font-semibold text-slate-700">
                              {formatCurrency(item.price)} each
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 rounded-[22px] border border-[color:var(--border)] bg-white/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground-soft)]">
                      Gift instructions
                    </p>
                    {order.giftWrap ? (
                      <div className="mt-2 space-y-1 text-sm text-slate-800">
                        <p>Gift wrap: Yes</p>
                        <p>Gift note: {order.giftNote || '-'}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">No gift instructions added.</p>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
