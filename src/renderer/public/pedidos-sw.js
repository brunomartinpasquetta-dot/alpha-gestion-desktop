/**
 * Service worker de la PWA de pedidos.
 *
 * Su unico trabajo es que la app ABRA sin conexion: cachea el shell (pagina y
 * assets) para que el dueño pueda cargar un pedido en el campo aunque el tunel
 * este caido. Los datos no se cachean aca: el catalogo lo cachea la app en
 * localStorage y los pedidos sin enviar viven en la cola offline.
 *
 * Estrategia: red primero con caida a cache. Asi una version nueva del sistema
 * se toma apenas hay conexion, y el cache solo entra cuando no la hay.
 */

const CACHE = 'alpha-pedidos-v2';

self.addEventListener('install', (evento) => {
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // La API nunca se cachea: un pedido viejo servido desde cache seria mentirle
  // al usuario. La cola offline de la app maneja la falta de conexion.
  if (evento.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname === '/health') {
    return;
  }

  evento.respondWith(
    fetch(evento.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE).then((cache) => cache.put(evento.request, copia)).catch(() => {});
        return respuesta;
      })
      .catch(() =>
        caches.match(evento.request).then(
          (guardada) =>
            guardada ??
            // Navegacion sin red ni cache exacto: servir el shell de pedidos.
            caches.match('/pedidos').then((shell) => shell ?? Response.error()),
        ),
      ),
  );
});
