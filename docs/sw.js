/* Service worker — Prépa JA Badminton.
 * - précache de l'application, des questions et du texte des règlements (fonctionne hors ligne
 *   dès la première visite) ;
 * - pack PDF téléchargeable à la demande (cache séparé, conservé entre deux versions) ;
 * - BUILD est réécrit automatiquement par scripts/build_site.py à chaque changement de contenu.
 */
const BUILD = '20f1fa302135';
const CORE = `core-${BUILD}`;
const PDF = 'pdf-v1';
const RUNTIME = 'runtime-v1';
const FRESH = ['data/catalog.json', 'data/updates.json', 'data/precache.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('data/precache.json', { cache: 'no-store' });
    const manifest = await res.json();
    const cache = await caches.open(CORE);
    const urls = [...manifest.core, 'data/precache.json'];
    // par lots pour limiter la pression réseau sur mobile
    for (let i = 0; i < urls.length; i += 25) {
      await cache.addAll(urls.slice(i, i + 25).map((u) => new Request(u, { cache: 'reload' })));
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => (k.startsWith('core-') && k !== CORE) || k === RUNTIME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'BUILD') event.source?.postMessage({ type: 'BUILD', build: BUILD });
});

const sameOrigin = (url) => url.origin === self.location.origin;
const scopePath = new URL(self.registration.scope).pathname;
const rel = (url) => url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : url.pathname;

// le cache de la version courante est toujours consulté en premier
async function fromCaches(request) {
  for (const cacheName of [CORE, PDF, RUNTIME]) {
    const hit = await caches.match(request, { ignoreSearch: true, cacheName });
    if (hit) return hit;
  }
  return undefined;
}

async function cacheFirst(request, cacheName) {
  const cached = await fromCaches(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && cacheName) (await caches.open(cacheName)).put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res.ok) (await caches.open(RUNTIME)).put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await fromCaches(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!sameOrigin(url)) return;
  const path = rel(url);

  if (request.mode === 'navigate') {
    // coquille applicative servie depuis le cache : cohérente avec les scripts de la même version
    event.respondWith((async () => {
      const shell = (await caches.match('./', { ignoreSearch: true, cacheName: CORE }))
        || (await caches.match('index.html', { cacheName: CORE }));
      if (shell && (path === '' || path === 'index.html')) return shell;
      try {
        return await fetch(request);
      } catch {
        return shell || Response.error();
      }
    })());
    return;
  }
  if (FRESH.includes(path)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (path.startsWith('reglements/pdf/')) {
    event.respondWith(cacheFirst(request, PDF));
    return;
  }
  event.respondWith(cacheFirst(request, RUNTIME));
});
