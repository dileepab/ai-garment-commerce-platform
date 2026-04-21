import Link from 'next/link';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function getStatusClass(status: string): string {
  return status === 'active' ? 'app-chip app-chip-accent' : 'app-chip app-chip-neutral';
}

export default async function OperatorsPage() {
  const operators = await prisma.operator.findMany({
    include: { operatorOutputs: true },
    orderBy: { id: 'asc' },
  });

  return (
    <main className="app-shell">
      <div className="app-container space-y-6">
        <div className="app-header">
          <div>
            <p className="app-kicker">Operators</p>
            <h1 className="app-title">Operator performance with better contrast</h1>
            <p className="app-subtitle">
              Output totals, skills, and current status are easier to scan in a card layout that works better on both
              desktop and smaller screens.
            </p>
          </div>
          <Link href="/" className="app-link">
            Back to Dashboard
          </Link>
        </div>

        {operators.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">No operators registered yet</h2>
            <p className="mt-3 text-sm text-[color:var(--foreground-soft)]">
              Operator records will appear here once added to the system.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {operators.map((operator) => {
              const totalOutput = operator.operatorOutputs.reduce((acc, current) => acc + current.outputQty, 0);
              const totalDefects = operator.operatorOutputs.reduce((acc, current) => acc + current.defects, 0);

              return (
                <article key={operator.id} className="app-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Operator #{operator.id}
                      </p>
                      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{operator.name}</h2>
                      <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
                        Skill: {operator.skill || 'Unassigned'}
                      </p>
                    </div>
                    <span className={getStatusClass(operator.status)}>{operator.status}</span>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Total output
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{totalOutput}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                        Defects logged
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-slate-950">{totalDefects}</p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-[22px] border border-[color:var(--border)] bg-white/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                      Stored efficiency
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{operator.efficiency}%</p>
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
