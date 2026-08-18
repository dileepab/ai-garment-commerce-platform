/**
 * Service worker for the installed app.
 *
 * Deliberately caches nothing. This is an operations console where a stale
 * order or a stale conversation is worse than a slow one, so every request
 * goes to the network exactly as it would without a worker. The worker exists
 * for push notifications, and for the fetch listener below.
 */

self.addEventListener('install', () => {
  // Replace an older worker immediately rather than waiting for every tab to
  // close, otherwise a notification fix ships but does not take effect.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Present but intentionally passive. Browsers have historically gated install
 * prompts on a worker having a fetch handler; not calling respondWith leaves
 * the request to the network untouched.
 */
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'GarmentOS', body: event.data.text(), url: '/support' };
  }

  const title = payload.title || 'GarmentOS';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Repeat notifications about one conversation replace each other rather
    // than stacking up while an operator is away from the phone.
    tag: payload.tag || payload.url || 'garmentos',
    renotify: true,
    data: { url: payload.url || '/support' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/support', self.location.origin);

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Reuse a window that is already open on this origin so tapping a
        // notification does not pile up duplicate app windows.
        for (const client of clientList) {
          if (new URL(client.url).origin !== targetUrl.origin) continue;
          if ('focus' in client) {
            client.navigate(targetUrl.href);
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl.href);
      })
  );
});
