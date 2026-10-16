/* Ancienne adresse de l'application (…/docs/). Ce service worker remplace l'ancien, se
 * désinstalle et renvoie les onglets ouverts vers la nouvelle adresse (sans /docs/). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const target = new URL('../', self.registration.scope).href;
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map((c) => c.navigate(target + new URL(c.url).hash).catch(() => {})));
  })());
});
