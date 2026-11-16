/* PIPFLOW Android & Desktop Web Push Service Worker Listener */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {
    title: 'PIPFLOW Alert',
    body: 'New activity on your PIPFLOW trading account.',
    url: '/dashboard',
    tag: 'pipflow-alert',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  };

  try {
    const parsed = event.data.json();
    data = { ...data, ...parsed };
  } catch {
    data.body = event.data.text() || data.body;
  }

  const options = {
    body: data.body,
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/pwa-192x192.png',
    tag: data.tag || 'pipflow-alert',
    renotify: true,
    vibrate: [180, 80, 180],
    data: {
      url: data.url || '/dashboard',
    },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
