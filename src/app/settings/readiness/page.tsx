import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { canScope, describeScope } from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import {
  CLEAN_LAUNCH_CONFIRMATION,
  CLEAN_LAUNCH_PRESERVED,
  getCleanLaunchResetPreview,
  getProductCatalogQualityReport,
  getProductionReliabilitySnapshot,
  type CleanLaunchResetCount,
  type ProductCatalogQualityReport,
  type ReliabilityCheck,
} from '@/lib/launch-readiness';
import { cleanLaunchResetAction } from './actions';

export const dynamic = 'force-dynamic';

const metricGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
  gap: 12,
} satisfies CSSProperties;

const toneClass: Record<ReliabilityCheck['status'], string> = {
  good: 'app-chip-success',
  warn: 'app-chip-warning',
  bad: 'app-chip-danger',
};

function formatDateTime(value: Date | string | null): string {
  if (!value) return 'Never';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'Unknown';

  return new Intl.DateTimeFormat('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Colombo',
  }).format(date);
}

function groupCounts(counts: CleanLaunchResetCount[]): Array<{ group: string; count: number; records: number }> {
  const grouped = new Map<string, { group: string; count: number; records: number }>();

  for (const item of counts) {
    const current = grouped.get(item.group) ?? { group: item.group, count: 0, records: 0 };
    current.count += 1;
    current.records += item.count;
    grouped.set(item.group, current);
  }

  return Array.from(grouped.values()).sort((a, b) => b.records - a.records);
}

function MetricCard({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const chipClass =
    tone === 'success'
      ? 'app-chip-success'
      : tone === 'warning'
        ? 'app-chip-warning'
        : tone === 'danger'
          ? 'app-chip-danger'
          : 'app-chip-neutral';

  return (
    <div className="app-subpanel" style={{ display: 'grid', gap: 6, minHeight: 118 }}>
      <p className="app-section-label">{label}</p>
      <strong style={{ fontSize: 26, lineHeight: 1, color: 'var(--color-fg-1)' }}>{value}</strong>
      <span className={`app-chip ${chipClass}`} style={{ justifySelf: 'start' }}>{tone}</span>
      <p className="app-muted" style={{ margin: 0, lineHeight: 1.45 }}>{note}</p>
    </div>
  );
}

function Section({
  label,
  title,
  note,
  children,
}: {
  label: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="app-panel" style={{ padding: 18, display: 'grid', gap: 14 }}>
      <div>
        <p className="app-section-label">{label}</p>
        <h2 style={{ margin: '4px 0 0', color: 'var(--color-fg-1)', fontSize: 20 }}>{title}</h2>
        {note && <p className="app-muted" style={{ marginTop: 5, maxWidth: 820 }}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function ProductQualitySection({ report }: { report: ProductCatalogQualityReport }) {
  const cleanPct = report.totalProducts > 0 ? Math.round((report.cleanProducts / report.totalProducts) * 100) : 0;

  return (
    <Section
      label="Product Catalog Quality"
      title="Fix product data before training the bot harder"
      note="The bot can only answer with the catalog data it has. Missing image, price, variants, stock, or product detail copy will leak into customer replies."
    >
      <div style={metricGridStyle}>
        <MetricCard
          label="Catalog Score"
          value={`${cleanPct}%`}
          tone={cleanPct >= 90 ? 'success' : cleanPct >= 70 ? 'warning' : 'danger'}
          note={`${report.cleanProducts} of ${report.totalProducts} products have no detected quality issues.`}
        />
        <MetricCard
          label="Products To Fix"
          value={`${report.issueProducts}`}
          tone={report.issueProducts === 0 ? 'success' : 'warning'}
          note="Products with one or more fields that weaken bot replies or catalog cards."
        />
        <MetricCard
          label="Top Issue"
          value={report.issueCounts[0]?.label || 'None'}
          tone={report.issueCounts.length === 0 ? 'success' : 'warning'}
          note={report.issueCounts[0] ? `${report.issueCounts[0].count} products affected.` : 'Catalog has the baseline fields covered.'}
        />
      </div>

      {report.issueCounts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {report.issueCounts.map((issue) => (
            <span key={issue.label} className="app-chip app-chip-warning">{issue.label}: {issue.count}</span>
          ))}
        </div>
      )}

      {report.rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-fg-3)' }}>
          No catalog quality issues detected.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Brand</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Variants</th>
                <th>Issues</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.slice(0, 40).map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="app-muted" style={{ fontSize: 11 }}>{row.sku || `Product #${row.id}`}</div>
                  </td>
                  <td>{row.brand || 'Missing'}</td>
                  <td>Rs {row.price.toLocaleString()}</td>
                  <td>{row.totalVariantAvailable || row.stock}</td>
                  <td>{row.variantCount}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {row.issues.map((issue) => (
                        <span key={issue} className="app-chip app-chip-warning">{issue}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <Link className="btn btn-secondary" style={{ minHeight: 28, padding: '5px 10px' }} href="/products">
                      Open Products
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function ReliabilitySection({
  checks,
  recentFailures,
}: {
  checks: ReliabilityCheck[];
  recentFailures: Array<{ source: string; status: string; detail: string; at: string }>;
}) {
  return (
    <Section
      label="Production Reliability"
      title="Live health signals"
      note="A compact launch view for DB health, Meta configuration, webhook failures, queue failures, bot activity, and delivery logging."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 10 }}>
        {checks.map((check) => (
          <div key={check.label} className="app-subpanel" style={{ display: 'grid', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <p className="app-section-label">{check.label}</p>
              <span className={`app-chip ${toneClass[check.status]}`}>{check.status}</span>
            </div>
            <strong style={{ fontSize: 20, color: 'var(--color-fg-1)' }}>{check.value}</strong>
            <p className="app-muted" style={{ margin: 0, lineHeight: 1.45 }}>{check.detail}</p>
          </div>
        ))}
      </div>

      <div className="app-subpanel" style={{ overflowX: 'auto' }}>
        <p className="app-section-label">Recent failures</p>
        {recentFailures.length === 0 ? (
          <p className="app-muted" style={{ marginTop: 8 }}>No recent reliability failures found.</p>
        ) : (
          <table className="data-table" style={{ marginTop: 8, minWidth: 760 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {recentFailures.map((failure, index) => (
                <tr key={`${failure.source}:${failure.status}:${failure.at}:${index}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{failure.at}</td>
                  <td>{failure.source}</td>
                  <td>{failure.status}</td>
                  <td>{failure.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}

function CleanLaunchResetSection({
  counts,
  catalogCounts,
  canManage,
  lastReset,
}: {
  counts: CleanLaunchResetCount[];
  catalogCounts: CleanLaunchResetCount[];
  canManage: boolean;
  lastReset: { summary: string; actorEmail: string | null; createdAt: Date } | null;
}) {
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const catalogTotal = catalogCounts.reduce((sum, item) => sum + item.count, 0);

  return (
    <Section
      label="Clean Launch Reset"
      title="Dry-run counts and guarded production cleanup"
      note="This removes test conversations, orders, generated content, support cases, logs, and operational demo rows while preserving settings and brand configuration. Product catalog deletion is a separate checkbox."
    >
      <div style={metricGridStyle}>
        <MetricCard label="Default Reset" value={`${total}`} tone={total === 0 ? 'success' : 'warning'} note="Records that will be deleted while preserving product catalog." />
        <MetricCard label="Catalog Add-on" value={`${catalogTotal}`} tone={catalogTotal === 0 ? 'success' : 'danger'} note="Extra records deleted only if product catalog cleanup is checked." />
        <MetricCard
          label="Last Reset"
          value={lastReset ? formatDateTime(lastReset.createdAt) : 'Never'}
          tone={lastReset ? 'neutral' : 'success'}
          note={lastReset ? `${lastReset.summary}${lastReset.actorEmail ? ` by ${lastReset.actorEmail}` : ''}` : 'No cleanup has been applied from this screen.'}
        />
      </div>

      <div className="app-subpanel">
        <p className="app-section-label">Preserved data</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {CLEAN_LAUNCH_PRESERVED.map((label) => (
            <span key={label} className="app-chip app-chip-success">{label}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
        <div className="app-subpanel">
          <p className="app-section-label">Delete preview by area</p>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {groupCounts(counts).map((group) => (
              <div key={group.group} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 800, color: 'var(--color-fg-1)', textTransform: 'capitalize' }}>{group.group}</span>
                <span className="app-muted">{group.records} records · {group.count} tables</span>
              </div>
            ))}
          </div>
        </div>

        <form action={cleanLaunchResetAction} className="app-subpanel" style={{ display: 'grid', gap: 12 }}>
          <p className="app-section-label">Guarded action</p>
          <p className="app-muted" style={{ margin: 0 }}>
            To apply the cleanup, type <strong>{CLEAN_LAUNCH_CONFIRMATION}</strong>. The action is logged in Admin Audit.
          </p>
          <label className="app-field">
            <span>Confirmation phrase</span>
            <input className="app-input" name="confirmation" placeholder={CLEAN_LAUNCH_CONFIRMATION} disabled={!canManage} />
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--color-fg-2)', lineHeight: 1.45 }}>
            <input name="includeCatalog" type="checkbox" disabled={!canManage} />
            Also delete product catalog, variants, inventory, and product images.
          </label>
          <button className="btn btn-primary" type="submit" disabled={!canManage} style={{ justifySelf: 'start' }}>
            Delete test data
          </button>
        </form>
      </div>

      <details className="app-subpanel">
        <summary style={{ cursor: 'pointer', fontWeight: 900, color: 'var(--color-fg-2)' }}>
          Full table preview
        </summary>
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="data-table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Area</th>
                <th>Table</th>
                <th>Records</th>
              </tr>
            </thead>
            <tbody>
              {[...counts, ...catalogCounts].map((row) => (
                <tr key={row.key}>
                  <td style={{ textTransform: 'capitalize' }}>{row.group}</td>
                  <td>{row.label}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Section>
  );
}

export default async function LaunchReadinessPage() {
  const scope = await requirePagePermission('settings:view');
  const canManage = canScope(scope, 'settings:write');
  const qualityReport = await getProductCatalogQualityReport();
  const reliability = await getProductionReliabilitySnapshot();
  const resetCounts = await getCleanLaunchResetPreview(false);
  const resetCountsWithCatalog = await getCleanLaunchResetPreview(true);
  const lastReset = await prisma.adminAuditLog.findFirst({
    where: { action: 'clean_launch_reset_applied' },
    orderBy: { createdAt: 'desc' },
    select: { summary: true, actorEmail: true, createdAt: true },
  });
  const savedRegressionDrafts = await prisma.adminAuditLog.count({
    where: { action: 'bot_regression_draft_saved' },
  });
  const catalogOnlyCounts = resetCountsWithCatalog.filter(
    (count) => !resetCounts.some((base) => base.key === count.key)
  );

  return (
    <main className="main">
      <PageHeader
        title="Launch Readiness"
        subtitle={`Production prep for catalog quality, reliability, cleanup, and saved bot regression drafts · ${describeScope(scope)}`}
        actions={
          <>
            <Link className="btn btn-secondary" href="/settings">Settings</Link>
            <Link className="btn btn-secondary" href="/settings/meta">Meta status</Link>
            <Link className="btn btn-secondary" href="/support/insights">Bot Insights</Link>
            <span className="app-chip app-chip-neutral">{savedRegressionDrafts} regression drafts</span>
          </>
        }
      />

      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <ReliabilitySection checks={reliability.checks} recentFailures={reliability.recentFailures} />
        <ProductQualitySection report={qualityReport} />
        <CleanLaunchResetSection
          counts={resetCounts}
          catalogCounts={catalogOnlyCounts}
          canManage={canManage}
          lastReset={lastReset}
        />
      </div>
    </main>
  );
}
