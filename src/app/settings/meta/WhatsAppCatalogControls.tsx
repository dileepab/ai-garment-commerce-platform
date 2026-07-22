'use client';

import { useState, useTransition, type ReactNode } from 'react';
import {
  syncWhatsAppCatalogAction,
  testWhatsAppCatalogAction,
  type WhatsAppCatalogConnectionActionResult,
  type WhatsAppCatalogSyncActionResult,
} from './actions';

function ResultBox({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${ok ? 'var(--color-success-muted)' : 'var(--color-error-muted)'}`,
        background: ok ? '#EDFAF4' : 'var(--color-error-muted)',
        color: ok ? 'var(--color-success)' : 'var(--color-error)',
        fontSize: 11,
        lineHeight: 1.45,
        padding: '7px 9px',
      }}
    >
      {children}
    </div>
  );
}

export function WhatsAppCatalogControls({
  brand,
  disabled,
  feedUrl,
}: {
  brand: string;
  disabled: boolean;
  feedUrl?: string;
}) {
  const [isTestPending, startTestTransition] = useTransition();
  const [isSyncPending, startSyncTransition] = useTransition();
  const [testResult, setTestResult] = useState<WhatsAppCatalogConnectionActionResult | null>(null);
  const [syncResult, setSyncResult] = useState<WhatsAppCatalogSyncActionResult | null>(null);

  function handleTest() {
    setTestResult(null);
    startTestTransition(async () => {
      try {
        setTestResult(await testWhatsAppCatalogAction(brand));
      } catch {
        setTestResult({
          success: false,
          ok: false,
          brand,
          checkedAt: new Date().toISOString(),
          error: 'Could not test the WhatsApp catalog. Please try again.',
        });
      }
    });
  }

  function handleSync() {
    setSyncResult(null);
    startSyncTransition(async () => {
      try {
        setSyncResult(await syncWhatsAppCatalogAction(brand));
      } catch {
        setSyncResult({
          success: false,
          ok: false,
          brand,
          checkedAt: new Date().toISOString(),
          configured: false,
          submitted: 0,
          upserted: 0,
          deleted: 0,
          skipped: 0,
          validationErrors: 0,
          error: 'Could not sync the WhatsApp catalog. Please try again.',
        });
      }
    });
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-border-subtle)',
        display: 'grid',
        gap: 8,
        paddingTop: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-fg-1)' }}>
          WhatsApp product catalog
        </div>
        <p className="app-muted" style={{ fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>
          Product saves submit immediate changes to Meta. After this feed URL is connected in Meta Commerce Manager, it provides the scheduled full refresh for product details and stock.
        </p>
      </div>
      {feedUrl && (
        <a
          className="btn btn-secondary"
          href={feedUrl}
          target="_blank"
          rel="noreferrer"
          style={{ justifyContent: 'center' }}
        >
          Open catalog feed
        </a>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleTest}
          disabled={disabled || isTestPending || isSyncPending}
          style={{ justifyContent: 'center' }}
        >
          {isTestPending ? 'Testing...' : 'Test catalog'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSync}
          disabled={disabled || isSyncPending || isTestPending}
          style={{ justifyContent: 'center' }}
        >
          {isSyncPending ? 'Syncing...' : 'Sync products now'}
        </button>
      </div>
      {disabled && (
        <p className="app-muted" style={{ fontSize: 11, lineHeight: 1.45 }}>
          Save the WABA ID, Catalog ID, Phone Number ID, and system-user token to enable catalog tests and immediate sync.
        </p>
      )}
      {testResult && (
        <ResultBox ok={testResult.ok}>
          {testResult.ok
            ? `${testResult.catalogName || brand} is connected, visible in WhatsApp, and ${testResult.cartEnabled ? 'cart is enabled' : 'cart is disabled'}.`
            : testResult.error || 'Catalog connection test failed.'}
        </ResultBox>
      )}
      {syncResult && (
        <ResultBox ok={syncResult.ok}>
          {syncResult.ok
            ? syncResult.submitted > 0
              ? `Submitted ${syncResult.upserted} upsert${syncResult.upserted === 1 ? '' : 's'} and ${syncResult.deleted} deletion${syncResult.deleted === 1 ? '' : 's'} to Meta${syncResult.skipped > 0 ? `; skipped ${syncResult.skipped} incomplete product${syncResult.skipped === 1 ? '' : 's'}` : ''}. Meta processes the batch asynchronously; the scheduled feed reconciles the final catalog state.`
              : `Catalog is ready. There are no eligible ${brand} product changes to submit yet${syncResult.skipped > 0 ? ` (${syncResult.skipped} product${syncResult.skipped === 1 ? '' : 's'} need a SKU and public image)` : ''}.`
            : syncResult.error || 'Catalog sync failed.'}
        </ResultBox>
      )}
    </div>
  );
}
