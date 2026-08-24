'use client';

import { useState, useTransition } from 'react';
import { testConversionsApiAction, type ConversionsApiTestResult } from './actions';

/**
 * Proves the Purchase event reaches Meta without waiting for a real sale.
 *
 * The event it sends carries a deliberately fake click id and a value of
 * zero, so Meta credits it to no ad and no campaign's reported numbers move.
 */
export function ConversionsApiTestButton({
  brand,
  disabled,
}: {
  brand: string;
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ConversionsApiTestResult | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await testConversionsApiAction(brand));
      } catch {
        setResult({
          success: false,
          ok: false,
          brand,
          checkedAt: new Date().toISOString(),
          datasetIdSuffix: '',
          testEventCodeActive: false,
          missing: [],
          error: 'Could not run the Conversions API check. Please try again.',
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
        marginTop: 4,
        paddingTop: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-fg-1)' }}>
          Purchase reporting
        </div>
        <p className="app-muted" style={{ fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>
          Sends one test purchase to Meta so ad spend can be judged on orders instead of
          conversations. It uses a fake click reference and a value of zero, so it never
          changes what any campaign reports.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleClick}
        disabled={disabled || isPending}
        style={{ justifyContent: 'center' }}
      >
        {isPending ? 'Checking...' : 'Test purchase reporting'}
      </button>
      {result && (
        <div
          style={{
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${result.ok ? 'var(--color-success-muted)' : 'var(--color-error-muted)'}`,
            background: result.ok ? '#EDFAF4' : 'var(--color-error-muted)',
            color: result.ok ? 'var(--color-success)' : 'var(--color-error)',
            fontSize: 11,
            lineHeight: 1.45,
            padding: '7px 9px',
          }}
        >
          {result.ok ? (
            <>
              Meta accepted the purchase event
              {result.datasetIdSuffix ? ` into dataset …${result.datasetIdSuffix}` : ''}.
              {result.testEventCodeActive && (
                <>
                  {' '}
                  <strong>
                    A test event code is set, so real sales are going to Test Events and are
                    not being credited. Remove META_CONVERSIONS_TEST_EVENT_CODE.
                  </strong>
                </>
              )}
            </>
          ) : (
            <>
              {result.error || 'The check failed.'}
              {/* Meta names the offending field, which is the only way to tell a
                  wrong dataset id from a token that cannot write to it. */}
              {result.detail && (
                <div style={{ marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                  {result.detail}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
