// acopia · service worker: app offline, datos siempre desde el servidor
const CACHE = 'acopia-v5';
// landing en / y app en /login y /dashboard/… (app.html)
const SHELL = ['/', '/app.html', '/manifest.json', '/icon.svg', '/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('api.php') || u.pathname.includes('/uploads/')) return;
  if (u.pathname.endsWith('version.json')) return; // siempre de la red
  // red primero, revalidando (no-cache) para que una versión nueva llegue al recargar
  const req = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request, { cache: 'no-cache' });
  e.respondWith(req.then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(async () => (await caches.match(e.request, { ignoreSearch: true }))
    // sin señal en el campo: cualquier dirección de la app abre la app guardada
    || (e.request.mode === 'navigate' ? caches.match(/^\/(login|dashboard)(\/|$)/.test(u.pathname) ? '/app.html' : '/') : undefined)));
});
self.addEventListener('message', e => { if (e.data === 'actualizar') self.skipWaiting(); });
