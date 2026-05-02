'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReturnRequestDrawer } from '@/components/ReturnComponents';
import type { SerializedReturnRequest } from '@/components/ReturnComponents';

interface ReturnsStats {
  total: number;
  open: number;
  pendingItemReceipt: number;
  completed: number;
  returns: number;
  exchanges: number;
}

const STATUS_COLORS: Record<string, string> = {
  requested: '#E8C840',
  under_review: '#4A7AA8',
  approved: '#38A169',
  rejected: '#C04A4A',
  item_received: '#8B5CF6',
  replacement_processing: '#DD6B20',
  completed: '#1E6B45',
};

const TYPE_COLORS: Record<string, string> = {
  return: '#A07050',
  exchange: '#4A7AA8',
};

export default function ReturnRequestsPageClient({
  initialRequests,
  stats,
  canManage,
}: {
  initialRequests: SerializedReturnRequest[];
  stats: ReturnsStats;
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<SerializedReturnRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = initialRequests.filter((r) => {
    if (statusFilter === 'open' && ['rejected', 'completed'].includes(r.status)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'open' && r.status !== statusFilter) return false;
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        String(r.id).includes(q) ||
        String(r.orderId).includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        (r.customer?.name?.toLowerCase().includes(q) ?? false) ||
        (r.brand?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-fg-1)', marginBottom: 4 }}>
          Returns & Exchanges
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-fg-3)' }}>
          Manage post-delivery return and exchange requests.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total', value: stats.total },
          { label: 'Open', value: stats.open },
          { label: 'Awaiting Item', value: stats.pendingItemReceipt },
          { label: 'Completed', value: stats.completed },
          { label: 'Returns', value: stats.returns },
          { label: 'Exchanges', value: stats.exchanges },
        ].map((s) => (
          <div key={s.label} style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-fg-1)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          className="search-input"
          placeholder="Search by ID, order, customer, reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
        />
        <select
          className="search-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="requested">Requested</option>
          <option value="under_review">Under review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="item_received">Item received</option>
          <option value="replacement_processing">Replacement processing</option>
          <option value="completed">Completed</option>
        </select>
        <select
          className="search-input"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="return">Returns</option>
          <option value="exchange">Exchanges</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['ID', 'Order', 'Customer', 'Type', 'Reason', 'Status', 'Stock', 'Created'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 10px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--color-fg-3)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '24px 10px', textAlign: 'center', color: 'var(--color-fg-3)', fontSize: 13 }}>
                  No return or exchange requests found.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr
                key={r.id}
                style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
                onClick={() => setSelected(r)}
                className="table-row-hover"
              >
                <td style={{ padding: '10px 10px' }}>
                  <code style={{ fontSize: 12, fontWeight: 600 }}>#{r.id}</code>
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <code style={{ fontSize: 12 }}>ORD-{r.orderId}</code>
                </td>
                <td style={{ padding: '10px 10px' }}>
                  {r.customer?.name ?? '—'}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: TYPE_COLORS[r.type] + '22',
                      color: TYPE_COLORS[r.type],
                    }}
                  >
                    {r.type === 'exchange' ? 'Exchange' : 'Return'}
                  </span>
                </td>
                <td style={{ padding: '10px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.reason}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: (STATUS_COLORS[r.status] ?? '#888') + '22',
                      color: STATUS_COLORS[r.status] ?? '#888',
                    }}
                  >
                    {r.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td style={{ padding: '10px 10px', fontSize: 11 }}>
                  {r.stockReconciled ? (
                    <span style={{ color: '#38A169', fontWeight: 600 }}>✓ Reconciled</span>
                  ) : (
                    <span style={{ color: 'var(--color-fg-3)' }}>Pending</span>
                  )}
                </td>
                <td style={{ padding: '10px 10px', fontSize: 11, color: 'var(--color-fg-3)', whiteSpace: 'nowrap' }} suppressHydrationWarning>
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReturnRequestDrawer
        request={selected}
        onClose={() => {
          setSelected(null);
          router.refresh();
        }}
        canManage={canManage}
      />
    </div>
  );
}
