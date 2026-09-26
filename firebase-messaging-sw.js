// Service worker da agenda: recebe as notificações push (FCM) e guarda o app para abrir sem internet.
// Não usa o SDK do Firebase aqui: o servidor envia mensagens "data-only" e este arquivo monta a notificação,
// o que evita notificação duplicada e garante que ela apareça mesmo com o app aberto.

const VERSION = '2.0.0';
const SHELL_CACHE = `agenda-shell-${VERSION}`;
const CDN_CACHE = 'agenda-cdn-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './firebase-config.js',
  './js/app.js',
  './js/firebase.js',
  './js/logic.js',
  './js/notifications.js',
  './js/store.js',
  './js/ui.js',
  './js/views/agenda.js',
  './js/views/appointment.js',
  './js/views/clients.js',
  './js/views/components.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/badge-96.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch((err) => console.warn('Cache inicial incompleto:', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('agenda-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Arquivos do app: tenta a rede primeiro (sempre a versão mais nova) e cai para o cache sem internet.
// SDK do Firebase (URL com versão fixa): cache primeiro.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(caches.open(CDN_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && url.search === '') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

// ---------- Push ----------

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { data: { title: 'Agenda', body: event.data ? event.data.text() : '' } };
  }
  const d = payload.data || payload.notification || {};
  const title = d.title || 'Agenda';
  const options = {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    data: { url: d.url || './', apptId: d.apptId || '', mapsUrl: d.mapsUrl || '' },
    actions: d.mapsUrl ? [{ action: 'map', title: 'Abrir no mapa' }] : []
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((w) => w.postMessage({ type: 'push', data: d }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action === 'map' && data.mapsUrl) {
    event.waitUntil(self.clients.openWindow(data.mapsUrl));
    return;
  }
  const target = new URL(data.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (existing) {
      await existing.focus();
      if (data.apptId) existing.postMessage({ type: 'open-appt', apptId: data.apptId });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
