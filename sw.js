/* KRMAS Instructor App — service worker (offline support) */
const VERSION = '111';
const CACHE = 'krmas-roster-v' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './app.js?v=' + VERSION,
  './db.js?v=' + VERSION,
  './data.js?v=' + VERSION,
  './styles.css?v=' + VERSION,
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './krmas-logo.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  // Never cache Supabase API / auth / data responses. Caching authenticated,
  // dynamic data serves stale or empty results — e.g. uploaded documents vanishing
  // on a device that cached an old/empty response. These must always hit the network.
  if (url.hostname.endsWith('.supabase.co')) return;
  // Network-first for HTML so updates land fast; cache-first for static assets.
  if (e.request.mode === 'navigate' || e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }))
    );
  }
});

/* Push notification handler */
self.addEventListener('push', e => {
  let data = { title: 'KRMAS', body: 'You have a new notification.' };
  try { data = e.data.json(); } catch(err) {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'KRMAS', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: data.url || './',
      tag: data.tag || 'krmas-' + Date.now(),
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(e.notification.data || './');
    })
  );
});
