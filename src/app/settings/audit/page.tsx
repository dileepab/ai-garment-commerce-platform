import prisma from '@/lib/prisma';
import {
  describeScope,
  getBrandScopeValues,
} from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import { PageHeader } from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

function formatAction(action: string): string {
  return action
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function summarizeMetadata(metadata?: string | null): string | null {
  if (!metadata) return null;

  try {
    const parsed = JSON.parse(metadata) as unknown;
    const text = JSON.stringify(parsed, null, 2);
    return text.length > 260 ? `${text.slice(0, 260)}...` : text;
  } catch {
    return metadata.length > 260 ? `${metadata.slice(0, 260)}...` : metadata;
  }
}

export default async function AuditLogPage() {
  const scope = await requirePagePermission('settings:view');
  const brandScope = getBrandScopeValues(scope);
  const logs = await prisma.adminAuditLog.findMany({
    where: brandScope ? { brand: { in: brandScope } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <main className="main">
      <PageHeader
        title="Audit Log"
        subtitle="Recent admin actions, webhook outcomes, support workflow changes, and settings checks"
        actions={<span className="app-chip app-chip-neutral">{describeScope(scope)}</span>}
      />

      <div className="content">
        <section className="app-panel" style={{ overflowX: 'auto' }}>
          {logs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-fg-3)', fontSize: 13 }}>
              No audit entries found.
            </div>
          ) : (
            <table className="data-table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Brand</th>
                  <th>Entity</th>
                  <th>Actor</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const metadata = summarizeMetadata(log.metadata);
                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.createdAt).toLocaleString()}</td>
                      <td>
                        <span className="app-chip app-chip-neutral">{formatAction(log.action)}</span>
                      </td>
                      <td>{log.brand || 'Global'}</td>
                      <td>
                        {log.entityType ? (
                          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {log.entityType}{log.entityId ? `:${log.entityId}` : ''}
                          </code>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{log.actorEmail || 'system'}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-fg-1)' }}>{log.summary}</div>
                        {metadata && (
                          <pre style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--color-fg-3)' }}>
                            {metadata}
                          </pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
