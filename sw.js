// ════════════════════════════════════════════════════════════
// 2TOCH — Service Worker (notifications Push appel entrant)
// ════════════════════════════════════════════════════════════
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }

  const options = {
    body: payload.body || 'Appel entrant',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    vibrate: [300, 100, 300, 100, 300],
    tag: 'incoming-call',
    renotify: true,
    requireInteraction: true, // reste visible jusqu'à interaction
    data: payload.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || '📞 2TOCH', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Si l'app est déjà ouverte dans un onglet, on la focus
      for (const client of list) {
        if (client.url.includes('2toch') && 'focus' in client) {
          client.postMessage({ type: 'incoming-call-tap', data: event.notification.data });
          return client.focus();
        }
      }
      // Sinon on ouvre l'app
      return clients.openWindow('/app.html');
    })
  );
});
