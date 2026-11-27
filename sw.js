// Guarda la app en el celular para que abra rápido y funcione sin internet.
// Si cambias algún archivo, sube también este con un número nuevo en VERSION.
const VERSION = 'luvx-v7';
const ARCHIVOS = ['./', 'index.html', 'estilos.css', 'app.js', 'firebase-config.js', 'datos_iniciales.js', 'manifest.json', 'icono-192.png', 'icono-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Primero intenta internet (para tener siempre la última versión); si no hay, usa lo guardado.
  e.respondWith(
    fetch(e.request).then(r => {
      const copia = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
