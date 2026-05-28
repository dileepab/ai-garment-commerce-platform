'use client';

import { useState, useTransition } from 'react';
import {
  testMetaConnectionAction,
  type MetaConnectionChannel,
  type MetaConnectionTestResult,
} from './actions';

export function MetaConnectionTestButton({
  brand,
  channel,
  disabled,
}: {
  brand: string;
  channel: MetaConnectionChannel;
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<MetaConnectionTestResult | null>(null);

  const label = channel === 'facebook' ? 'Test Page token' : 'Test IG token';

  function handleClick() {
    startTransition(async () => {
      const nextResult = await testMetaConnectionAction(brand, channel);
      setResult(nextResult);
    });
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleClick}
        disabled={disabled || isPending}
        style={{ justifyContent: 'center' }}
      >
        {isPending ? 'Testing...' : label}
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
              Connected
              {result.name ? `: ${result.name}` : result.username ? `: @${result.username}` : ''}
              {result.host ? ` via ${result.host}` : ''}
            </>
          ) : (
            result.error || 'Connection failed.'
          )}
        </div>
      )}
    </div>
  );
}
