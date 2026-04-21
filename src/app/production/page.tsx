import Link from 'next/link';
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

function getCompletionPercentage(plannedQty: number, finishedQty: number): number {
  if (plannedQty <= 0) {
    return 0;
  }

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
              The updated view uses readable cards and a simple progress indicator so planned and finished quantities
              stand out immediately.
            </p>
          </div>
          <Link href="/" className="app-link">
            Back to Dashboard
          </Link>
        </div>

        {batches.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">No production batches found</h2>
            <p className="mt-3 text-sm text-[color:var(--foreground-soft)]">
              Planned and active production work will appear here.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {batches.map((batch) => {
              const completion = getCompletionPercentage(batch.plannedQty, batch.finishedQty);

              return (
                <article key={batch.id} className="app-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Batch #{batch.id}
                      </p>
                      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                        {batch.brand || 'Unassigned brand'}
                      </h2>
                      <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
                        Style: {batch.style || 'Not specified'}
                      </p>
                    </div>
                    <span className={getStatusClass(batch.status)}>{batch.status}</span>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Planned
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{batch.plannedQty}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Finished
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{batch.finishedQty}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Rejected
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{batch.rejectedQty}</p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-[22px] border border-[color:var(--border)] bg-white/70 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Completion
                      </p>
                      <p className="text-sm font-semibold text-slate-800">{completion}%</p>
                    </div>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#0f766e,#14b8a6)]"
                        style={{ width: `${completion}%` }}
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
