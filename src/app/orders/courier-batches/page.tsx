import Link from 'next/link';
import prisma from '@/lib/prisma';
import { PageHeader } from '@/components/PageHeader';
import { canAccessBrand } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { getBrandLookupAliases } from '@/lib/brand-aliases';
import { RoyalExpressBatchForm } from './RoyalExpressBatchForm';

export const dynamic = 'force-dynamic';

function sriLankaNoonDateTimeLocal() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}T12:00`;
}

function parseSriLankaDateTimeLocal(value: string) {
  return new Date(`${value}:00+05:30`);
}

export default async function CourierBatchesPage() {
  const scope = await requirePagePermission('orders:view');
  const defaultCutoff = sriLankaNoonDateTimeLocal();
  const cutoffAt = parseSriLankaDateTimeLocal(defaultCutoff);
  const activeSettings = await prisma.courierIntegrationSetting.findMany({
    where: {
      provider: 'royalexpress',
      isActive: true,
    },
    select: {
      brand: true,
      accountEmail: true,
      accountPassword: true,
      merchantBusinessId: true,
      pickupAddressId: true,
    },
    orderBy: { brand: 'asc' },
  });
  const visibleActiveBrands = activeSettings
    .filter((setting) => canAccessBrand(scope, setting.brand))
    .map((setting) => setting.brand);
  const brandCounts = await Promise.all(
    visibleActiveBrands.map(async (brand) => {
      const aliases = getBrandLookupAliases(brand);
      const eligibleCount = await prisma.order.count({
        where: {
          brand: { in: aliases },
          orderStatus: { in: ['confirmed', 'packing', 'packed'] },
          createdAt: { lte: cutoffAt },
          courierProcessedAt: null,
          courierShipments: {
            none: { provider: 'royalexpress' },
          },
        },
      });
      return { brand, eligibleCount };
    }),
  );
  const brands = brandCounts.filter((option) => option.eligibleCount > 0);
  const recentBatches = await prisma.courierBatch.findMany({
    where: {
      provider: 'royalexpress',
      ...(scope.brandAccess === 'limited' ? { brand: { in: scope.brands } } : {}),
    },
    include: {
      shipments: {
        select: {
          id: true,
          waybillId: true,
          orderId: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });

  return (
    <main className="main">
      <PageHeader
        title="RoyalExpress Batches"
        subtitle="Create daily Curfox waybills after the order edit window closes."
        actions={<Link className="btn btn-secondary" href="/orders">Back to orders</Link>}
      />

      <div style={{ display: 'grid', gap: 16 }}>
        <RoyalExpressBatchForm brands={brands} defaultCutoff={defaultCutoff} />

        <section className="app-panel" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Recent batches</div>
              <div style={{ fontSize: 12, color: 'var(--color-fg-3)' }}>
                Print labels after a batch succeeds, then pack and hand over the parcels.
              </div>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Brand</th>
                <th>Status</th>
                <th>Cutoff</th>
                <th>Waybills</th>
                <th>Failed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentBatches.map((batch) => (
                <tr key={batch.id}>
                  <td>#{batch.id}</td>
                  <td>{batch.brand || '-'}</td>
                  <td>{batch.status.replace(/_/g, ' ')}</td>
                  <td suppressHydrationWarning>{batch.cutoffAt.toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })}</td>
                  <td>{batch.successCount}</td>
                  <td>{batch.failureCount}</td>
                  <td style={{ textAlign: 'right' }}>
                    {batch.shipments.length > 0 ? (
                      <Link className="btn btn-secondary" style={{ fontSize: 11 }} href={`/orders/courier-batches/${batch.id}/labels`}>
                        Print labels
                      </Link>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-fg-3)' }}>No labels</span>
                    )}
                  </td>
                </tr>
              ))}
              {recentBatches.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--color-fg-3)' }}>
                    No RoyalExpress batches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
