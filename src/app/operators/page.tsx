import prisma from '@/lib/prisma';
import { requirePagePermission } from '@/lib/authz';

export const dynamic = 'force-dynamic';

function getStatusClass(status: string): string {
  return status === 'active' ? 'app-chip app-chip-accent' : 'app-chip app-chip-neutral';
}

export default async function OperatorsPage() {
  await requirePagePermission('operators:view');
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
            <h1 className="app-title">Operator performance</h1>
            <p className="app-subtitle">
              Output totals, skills, and current status across your production floor.
            </p>
          </div>
        </div>

        {operators.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--foreground)' }}>No operators registered yet</h2>
            <p className="mt-3 text-sm" style={{ color: 'var(--foreground-soft)' }}>
              Operator records will appear here once added to the system.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {operators.map((operator) => {
              const totalOutput = operator.operatorOutputs.reduce((acc, cur) => acc + cur.outputQty, 0);
              const totalDefects = operator.operatorOutputs.reduce((acc, cur) => acc + cur.defects, 0);
              const efficiency = operator.efficiency ?? 0;
              const efficiencyColor =
                efficiency >= 90 ? 'var(--success)' :
                efficiency >= 75 ? 'var(--warning)' :
                'var(--danger)';

              return (
                <article key={operator.id} className="app-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="app-section-label">Operator #{operator.id}</p>
                      <h2 className="mt-3 text-2xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
                        {operator.name}
                      </h2>
                      <p className="mt-2 text-sm" style={{ color: 'var(--foreground-soft)' }}>
                        Skill: {operator.skill || 'Unassigned'}
                      </p>
                    </div>
                    <span className={getStatusClass(operator.status)}>{operator.status}</span>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="app-stat-strip">
                      <p className="app-section-label">Total output</p>
                      <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--foreground)' }}>{totalOutput}</p>
                    </div>
                    <div className="app-stat-strip">
                      <p className="app-section-label">Defects logged</p>
                      <p className="mt-2 text-2xl font-semibold" style={{ color: totalDefects > 0 ? 'var(--warning)' : 'var(--foreground)' }}>
                        {totalDefects}
                      </p>
                    </div>
                  </div>

                  <div className="app-subpanel mt-6">
                    <div className="flex items-center justify-between">
                      <p className="app-section-label">Efficiency</p>
                      <p className="text-xl font-bold" style={{ color: efficiencyColor, letterSpacing: '-0.02em' }}>
                        {efficiency}%
                      </p>
                    </div>
                    <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${efficiency}%`, background: efficiencyColor }}
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
