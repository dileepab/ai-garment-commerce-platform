'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker once the app has loaded.
 *
 * Without a registered worker the app cannot be installed and cannot receive
 * push notifications. Registration is deliberately silent: a browser that does
 * not support workers, or a page served without HTTPS, simply carries on.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // Registering during load contends with the page's own requests, so it
    // waits for the window to settle first.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration costs the install prompt and notifications,
        // not the app itself, so there is nothing to show the operator.
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
