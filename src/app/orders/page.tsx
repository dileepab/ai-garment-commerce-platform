import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getDeliveryChargeForAddress } from '@/lib/order-draft';
import { getOrderStageLabel, getOrderStageNote, isActiveOrderStatus } from '@/lib/order-status-display';
import { OrderActionButtons } from './order-actions';

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
    hour: 'numeric',
    minute: '2-digit',
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

function getItemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    include: {
      customer: true,
      supportEscalations: {
        where: {
          status: {
            not: 'resolved',
          },
        },
      },
      orderItems: {
        include: {
          product: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  const activeOrders = orders.filter((order) => isActiveOrderStatus(order.orderStatus));
  const totalUnitsOnActiveOrders = activeOrders.reduce(
    (sum, order) => sum + order.orderItems.reduce((itemSum, item) => itemSum + item.quantity, 0),
    0
  );
  const giftOrderCount = activeOrders.filter((order) => order.giftWrap).length;
  const escalatedOrderCount = activeOrders.filter((order) => order.supportEscalations.length > 0).length;

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

        <section className="grid gap-4 md:grid-cols-3">
          <div className="app-metric">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
              Active orders
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{activeOrders.length}</p>
            <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
              Orders still in progress, packed, or confirmed.
            </p>
          </div>
          <div className="app-metric">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
              Units on order
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{totalUnitsOnActiveOrders}</p>
            <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
              Total quantity across active customer orders.
            </p>
          </div>
          <div className="app-metric">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
              Special handling
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {giftOrderCount + escalatedOrderCount}
            </p>
            <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
              {giftOrderCount} gift order(s) and {escalatedOrderCount} order(s) linked to support follow-up.
            </p>
          </div>
        </section>

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
              const uniqueStyles = order.orderItems.length;
              const deliveryCharge = getDeliveryChargeForAddress(order.deliveryAddress || '');
              const grandTotal = order.totalAmount + deliveryCharge;
              const subtotal = order.orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
              const leadItem = order.orderItems[0];

              return (
                <article key={order.id} id={`order-${order.id}`} className="app-card overflow-hidden">
                  <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                    <div>
                      <p className="app-section-label">Order Snapshot</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Order #{order.id}</h2>
                        <span className={getStatusClass(order.orderStatus)}>{getOrderStageLabel(order.orderStatus)}</span>
                        {order.giftWrap ? <span className="app-chip app-chip-warning">Gift order</span> : null}
                        {order.supportEscalations.length > 0 ? (
                          <Link href="/support" className="app-chip app-chip-danger">
                            Support follow-up
                          </Link>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
                        Placed on {formatDate(order.createdAt)}
                      </p>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-700">
                        {getOrderStageNote(order.orderStatus)}
                      </p>
                      <OrderActionButtons orderId={order.id} status={order.orderStatus} />
                    </div>

                    <div className="app-accent-block w-full sm:min-w-[220px] sm:w-auto">
                      <p className="app-section-label">Grand Total</p>
                      <p className="mt-3 app-highlight-value">{formatCurrency(grandTotal)}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        Subtotal {formatCurrency(subtotal)} plus delivery {formatCurrency(deliveryCharge)}.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="app-stat-strip">
                      <p className="app-section-label">Customer</p>
                      <p className="mt-3 text-base font-semibold text-slate-900">
                        {order.customer?.name || `ID ${order.customerId}`}
                      </p>
                      <p className="mt-1 text-sm text-[color:var(--foreground-soft)]">
                        {order.customer?.phone || 'Phone not stored'}
                      </p>
                    </div>
                    <div className="app-stat-strip">
                      <p className="app-section-label">Items Ordered</p>
                      <p className="mt-3 text-base font-semibold text-slate-900">{getItemsLabel(totalUnits)}</p>
                      <p className="mt-1 text-sm text-[color:var(--foreground-soft)]">
                        {uniqueStyles} style line{uniqueStyles === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="app-stat-strip">
                      <p className="app-section-label">Payment & Brand</p>
                      <p className="mt-3 text-base font-semibold text-slate-900">{order.paymentMethod || 'COD'}</p>
                      <p className="mt-1 text-sm text-[color:var(--foreground-soft)]">{order.brand || 'Brand not set'}</p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
                    <div className="space-y-4">
                      <div className="app-subpanel">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="app-section-label">Order Items</p>
                          <div className="app-badge-stack">
                            <span className="app-chip app-chip-warning">{getItemsLabel(totalUnits)}</span>
                            {leadItem ? <span className="app-chip app-chip-neutral">Lead item: {leadItem.product.name}</span> : null}
                          </div>
                        </div>

                        <div className="mt-4 app-list">
                          {order.orderItems.map((item) => {
                            const variants = [
                              formatVariantLabel('Size', item.size),
                              formatVariantLabel('Color', item.color),
                            ].filter(Boolean);
                            const lineTotal = item.price * item.quantity;

                            return (
                              <div key={item.id} className="app-item-card">
                                <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-lg font-semibold text-slate-900">{item.product.name}</p>
                                    <div className="mt-3 app-badge-stack">
                                      <span className="app-chip app-chip-warning">Qty {item.quantity}</span>
                                      {variants.map((variant) => (
                                        <span key={variant} className="app-chip app-chip-neutral">
                                          {variant}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="text-left sm:text-right">
                                    <p className="text-sm font-semibold text-slate-700">{formatCurrency(item.price)} each</p>
                                    <p className="mt-1 text-base font-semibold text-slate-950">
                                      {formatCurrency(lineTotal)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <aside className="space-y-4">
                      <div className="app-subpanel">
                        <p className="app-section-label">Delivery</p>
                        <p className="mt-3 text-sm leading-6 text-slate-800">
                          {order.deliveryAddress || 'Not provided'}
                        </p>
                      </div>

                      <div className="app-subpanel">
                        <p className="app-section-label">Order Breakdown</p>
                        <div className="mt-4 app-key-value">
                          <div className="app-key-value-row">
                            <p className="app-key">Subtotal</p>
                            <p className="app-value">{formatCurrency(subtotal)}</p>
                          </div>
                          <div className="app-key-value-row">
                            <p className="app-key">Delivery</p>
                            <p className="app-value">{formatCurrency(deliveryCharge)}</p>
                          </div>
                          <div className="app-key-value-row sm:col-span-2">
                            <p className="app-key">Grand Total</p>
                            <p className="app-value">{formatCurrency(grandTotal)}</p>
                          </div>
                        </div>
                      </div>

                      <div className={order.giftWrap ? 'app-warning-block' : 'app-subpanel'}>
                        <p className="app-section-label">Gift Instructions</p>
                        {order.giftWrap ? (
                          <div className="mt-4 space-y-3">
                            <div className="app-key-value-row">
                              <p className="app-key">Gift wrap</p>
                              <p className="app-value">Requested</p>
                            </div>
                            <div className="app-key-value-row">
                              <p className="app-key">Gift note</p>
                              <p className="app-value">{order.giftNote || '-'}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm leading-6 text-[color:var(--foreground-soft)]">
                            No gift instructions added for this order.
                          </p>
                        )}
                      </div>
                    </aside>
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
