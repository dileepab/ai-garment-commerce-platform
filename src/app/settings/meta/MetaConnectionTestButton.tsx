'use client';

import { useState, useTransition } from 'react';
import {
  registerWhatsAppPhoneAction,
  testMetaConnectionAction,
  type MetaConnectionChannel,
  type MetaConnectionTestResult,
  type WhatsAppRegistrationActionResult,
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
  const [isRegisterPending, startRegistrationTransition] = useTransition();
  const [result, setResult] = useState<MetaConnectionTestResult | null>(null);
  const [registrationResult, setRegistrationResult] = useState<WhatsAppRegistrationActionResult | null>(null);
  const [pin, setPin] = useState('');
  const [pinSaved, setPinSaved] = useState(false);

  const label = channel === 'facebook'
    ? 'Test Page token'
    : channel === 'instagram'
      ? 'Test IG token'
      : 'Test WhatsApp token';

  function handleClick() {
    startTransition(async () => {
      const nextResult = await testMetaConnectionAction(brand, channel);
      setResult(nextResult);
    });
  }

  function handleRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistrationResult(null);

    startRegistrationTransition(async () => {
      try {
        const nextResult = await registerWhatsAppPhoneAction(brand, pin);
        setRegistrationResult(nextResult);
      } catch {
        setRegistrationResult({
          success: false,
          ok: false,
          brand,
          checkedAt: new Date().toISOString(),
          error: 'Could not complete WhatsApp registration. Please try again.',
        });
      } finally {
        setPin('');
        setPinSaved(false);
      }
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
      {channel === 'whatsapp' && (
        <form
          onSubmit={handleRegistration}
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
              Register WhatsApp number
            </div>
            <p className="app-muted" style={{ fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>
              Choose a new six-digit WhatsApp two-step PIN. This is not the SMS verification code. DEEZ sends it once to Meta and does not store or log it.
            </p>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="app-section-label">Six-digit PIN</span>
            <input
              className="app-input"
              type="password"
              name="whatsapp-registration-pin"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              placeholder="••••••"
              aria-label="WhatsApp six-digit registration PIN"
              disabled={disabled || isRegisterPending}
              required
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11, color: 'var(--color-fg-2)' }}>
            <input
              type="checkbox"
              checked={pinSaved}
              onChange={(event) => setPinSaved(event.target.checked)}
              disabled={disabled || isRegisterPending}
              style={{ marginTop: 2 }}
            />
            <span>I saved this PIN in my password manager for future re-registration.</span>
          </label>
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={disabled || isRegisterPending || pin.length !== 6 || !pinSaved}
            style={{ justifyContent: 'center' }}
          >
            {isRegisterPending ? 'Registering...' : 'Register number'}
          </button>
          {registrationResult && (
            <div
              style={{
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${registrationResult.ok ? 'var(--color-success-muted)' : 'var(--color-error-muted)'}`,
                background: registrationResult.ok ? '#EDFAF4' : 'var(--color-error-muted)',
                color: registrationResult.ok ? 'var(--color-success)' : 'var(--color-error)',
                fontSize: 11,
                lineHeight: 1.45,
                padding: '7px 9px',
              }}
            >
              {registrationResult.ok
                ? 'Registered with Meta. DEEZ did not store your PIN.'
                : registrationResult.error || 'WhatsApp registration failed.'}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
