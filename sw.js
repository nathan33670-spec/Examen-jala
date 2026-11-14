/* Utile seulement si GitHub Pages publie la racine du dépôt : remplace une ancienne installation de
 * l'application faite à la racine du site, la désinstalle et renvoie vers l'application (docs/). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const target = new URL('docs/', self.registration.scope).href;
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map((c) => c.navigate(target + new URL(c.url).hash).catch(() => {})));
  })());
});
