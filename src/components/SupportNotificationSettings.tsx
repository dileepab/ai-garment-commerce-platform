'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * Turns support notifications on for this browser and holds its two switches.
 *
 * A subscription belongs to a browser, not a person, so this reads and writes
 * the state of the device it is running on. The permission prompt is fired
 * from the button press because browsers refuse it otherwise.
 *
 * On iOS none of this appears until the app has been added to the Home Screen:
 * Safari only exposes PushManager to an installed app, so the panel says so
 * rather than offering a button that cannot work.
 */

interface PushState {
  configured: boolean;
  publicKey: string;
  subscription: {
    endpoint: string;
    notifyEscalations: boolean;
    notifyAllMessages: boolean;
  } | null;
}

type Status = 'loading' | 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on' | 'unconfigured';

/** The VAPID key travels as base64url and must reach subscribe() as bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS predates display-mode and reports installation here instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function describeDevice(): string {
  const ua = navigator.userAgent;
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Macintosh/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Browser';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : 'Safari';
  return `${platform} · ${browser}`;
}

export default function SupportNotificationSettings() {
  const [status, setStatus] = useState<Status>('loading');
  const [escalations, setEscalations] = useState(true);
  const [allMessages, setAllMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      // Safari on iOS only exposes push to an installed app, so an iPhone in a
      // tab lands here and is told to install rather than that it cannot.
      setStatus(/iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone() ? 'needs-install' : 'unsupported');
      return;
    }

    if (!('PushManager' in window)) {
      setStatus(isStandalone() ? 'unsupported' : 'needs-install');
      return;
    }

    const registration = await navigator.serviceWorker.ready.catch(() => null);
    const existing = registration ? await registration.pushManager.getSubscription() : null;

    const query = existing ? `?endpoint=${encodeURIComponent(existing.endpoint)}` : '';
    const response = await fetch(`/api/push/subscription${query}`);
    const payload: { success: boolean; data?: PushState } = await response.json();

    if (!payload.success || !payload.data) {
      setStatus('unconfigured');
      return;
    }

    if (!payload.data.configured) {
      setStatus('unconfigured');
      return;
    }

    if (Notification.permission === 'denied') {
      setStatus('blocked');
      return;
    }

    if (existing && payload.data.subscription) {
      setEscalations(payload.data.subscription.notifyEscalations);
      setAllMessages(payload.data.subscription.notifyAllMessages);
      setStatus('on');
      return;
    }

    setStatus('off');
  }, []);

  useEffect(() => {
    load().catch(() => setStatus('unsupported'));
  }, [load]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const keyResponse = await fetch('/api/push/subscription');
      const keyPayload: { data?: PushState } = await keyResponse.json();
      const publicKey = keyPayload.data?.publicKey;

      if (!publicKey) {
        setStatus('unconfigured');
        return;
      }

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by Chrome: a push may not be silent and data-only.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));

      const json = subscription.toJSON();
      const response = await fetch('/api/push/subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: json.keys,
          deviceLabel: describeDevice(),
          notifyEscalations: escalations,
          notifyAllMessages: allMessages,
        }),
      });

      if (!response.ok) {
        setError('Could not save the subscription. Try again.');
        return;
      }

      setStatus('on');
      setOpen(true);
    } catch {
      setError('This browser refused the notification subscription.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch(`/api/push/subscription?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
          method: 'DELETE',
        });
        await subscription.unsubscribe();
      }

      setStatus('off');
      setOpen(false);
    } catch {
      setError('Could not turn notifications off.');
    } finally {
      setBusy(false);
    }
  };

  const savePreferences = async (next: { escalations: boolean; allMessages: boolean }) => {
    setEscalations(next.escalations);
    setAllMessages(next.allMessages);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;

      await fetch('/api/push/subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          notifyEscalations: next.escalations,
          notifyAllMessages: next.allMessages,
        }),
      });
    } catch {
      setError('Could not save that change.');
    }
  };

  if (status === 'loading' || status === 'unsupported' || status === 'unconfigured') return null;

  if (status === 'needs-install') {
    return (
      <div className="push-panel push-panel--hint">
        Add GarmentOS to your Home Screen to get notifications on this iPhone.
      </div>
    );
  }

  if (status === 'blocked') {
    return (
      <div className="push-panel push-panel--hint">
        Notifications are blocked for this site in your browser settings.
      </div>
    );
  }

  return (
    <div className="push-panel">
      <div className="push-panel-row">
        <button
          type="button"
          className={`btn ${status === 'on' ? 'btn-ghost' : 'btn-secondary'} push-toggle`}
          onClick={status === 'on' ? () => setOpen((value) => !value) : enable}
          disabled={busy}
          aria-expanded={status === 'on' ? open : undefined}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 01-3.4 0" />
            {status !== 'on' && <path d="M3 3l18 18" />}
          </svg>
          {status === 'on' ? 'Notifications on' : busy ? 'Enabling…' : 'Turn on notifications'}
        </button>
      </div>

      {status === 'on' && open && (
        <div className="push-panel-options">
          <label className="push-option">
            <input
              type="checkbox"
              checked={escalations}
              onChange={(event) =>
                savePreferences({ escalations: event.target.checked, allMessages })
              }
            />
            <span>
              <strong>Cases needing a human</strong>
              <em>When the bot hands a conversation over</em>
            </span>
          </label>

          <label className="push-option">
            <input
              type="checkbox"
              checked={allMessages}
              onChange={(event) =>
                savePreferences({ escalations, allMessages: event.target.checked })
              }
            />
            <span>
              <strong>Every inbound message</strong>
              <em>Including the ones the bot answers itself</em>
            </span>
          </label>

          <button type="button" className="btn btn-ghost push-disable" onClick={disable} disabled={busy}>
            Turn off on this device
          </button>
        </div>
      )}

      {error && <div className="push-panel-error">{error}</div>}
    </div>
  );
}
