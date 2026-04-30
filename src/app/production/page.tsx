import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function getStatusClass(status: string): string {
  switch (status) {
    case 'in_progress':
    case 'cutting':
    case 'sewing':
      return 'app-chip app-chip-accent';
    case 'planned':
      return 'app-chip app-chip-warning';
    case 'completed':
      return 'app-chip app-chip-neutral';
    default:
      return 'app-chip app-chip-neutral';
  }
}

function calcCompletion(plannedQty: number, finishedQty: number): number {
  if (plannedQty <= 0) return 0;
  return Math.min(100, Math.round((finishedQty / plannedQty) * 100));
}

export default async function ProductionPage() {
  const batches = await prisma.productionBatch.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="app-shell">
      <div className="app-container space-y-6">
        <div className="app-header">
          <div>
            <p className="app-kicker">Production</p>
            <h1 className="app-title">Production batches with clearer progress</h1>
            <p className="app-subtitle">
              Planned and finished quantities with a clear completion indicator per batch.
            </p>
          </div>
        </div>

        {batches.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--foreground)' }}>No production batches found</h2>
            <p className="mt-3 text-sm" style={{ color: 'var(--foreground-soft)' }}>
              Planned and active production work will appear here.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {batches.map((batch) => {
              const completion = calcCompletion(batch.plannedQty, batch.finishedQty);
              const isDelayed = batch.status === 'delayed';

              return (
                <article key={batch.id} className="app-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="app-section-label">Batch #{batch.id}</p>
                      <h2 className="mt-3 text-2xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
                        {batch.brand || 'Unassigned brand'}
                      </h2>
                      <p className="mt-2 text-sm" style={{ color: 'var(--foreground-soft)' }}>
                        Style: {batch.style || 'Not specified'}
                      </p>
                    </div>
                    <span className={getStatusClass(batch.status)}>{batch.status}</span>
                  </div>

                  {/* Quantity stats */}
                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    {[
                      { label: 'Planned',  value: batch.plannedQty },
                      { label: 'Finished', value: batch.finishedQty },
                      { label: 'Rejected', value: batch.rejectedQty },
                    ].map(({ label, value }) => (
                      <div key={label} className="app-stat-strip">
                        <p className="app-section-label">{label}</p>
                        <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--foreground)' }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar — terracotta accent, not teal */}
                  <div className="app-subpanel mt-6">
                    <div className="flex items-center justify-between gap-4">
                      <p className="app-section-label">Completion</p>
                      <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{completion}%</p>
                    </div>
                    <div
                      className="mt-3 h-2 overflow-hidden rounded-full"
                      style={{ background: 'var(--border)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${completion}%`,
                          background: isDelayed ? 'var(--warning)' : 'var(--accent)',
                        }}
                      />
                    </div>
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
