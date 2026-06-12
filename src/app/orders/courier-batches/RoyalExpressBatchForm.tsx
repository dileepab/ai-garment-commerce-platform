'use client';

import React, { useActionState } from 'react';
import Link from 'next/link';
import {
  processRoyalExpressBatchAction,
  type RoyalExpressBatchActionState,
} from '@/app/orders/actions';

interface BrandOption {
  brand: string;
  eligibleCount: number;
}

const initialState: RoyalExpressBatchActionState = { success: false };

export function RoyalExpressBatchForm({
  brands,
  defaultCutoff,
}: {
  brands: BrandOption[];
  defaultCutoff: string;
}) {
  const [state, formAction, isPending] = useActionState(processRoyalExpressBatchAction, initialState);
  const firstBrand = brands[0]?.brand ?? '';

  return (
    <form action={formAction} className="app-panel" style={{ padding: 20, display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(220px, 1fr) auto', gap: 12, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--color-fg-2)' }}>
          Brand
          <select
            name="brand"
            defaultValue={firstBrand}
            disabled={isPending || brands.length === 0}
            style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 10px', fontSize: 13 }}
          >
            {brands.map((option) => (
              <option key={option.brand} value={option.brand}>
                {option.brand} ({option.eligibleCount} ready)
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--color-fg-2)' }}>
          Cutoff time
          <input
            name="cutoffAt"
            type="datetime-local"
            defaultValue={defaultCutoff}
            disabled={isPending || brands.length === 0}
            style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 10px', fontSize: 13 }}
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={isPending || brands.length === 0}>
          {isPending ? 'Processing...' : 'Create waybills'}
        </button>
      </div>

      {brands.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--color-fg-3)' }}>
          No confirmed, packing, or packed orders are ready for an active RoyalExpress brand before the default cutoff.
        </div>
      )}

      {(state.message || state.error) && (
        <div
          style={{
            borderRadius: 8,
            padding: '10px 12px',
            background: state.success ? '#EEF8F1' : '#FFF7ED',
            color: state.success ? '#1E6B45' : '#9B4A00',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <span>{state.message || state.error}</span>
          {state.batchId && (
            <Link className="btn btn-secondary" style={{ fontSize: 11 }} href={`/orders/courier-batches/${state.batchId}/labels`}>
              Print labels
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
