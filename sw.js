// Service worker: l'app funziona offline partendo dai file salvati (cache-first).
// Ogni pubblicazione cambia CACHE: il nuovo service worker scarica i file aggiornati direttamente
// dal server (senza passare dalla cache HTTP), si attiva subito e l'app mostra "Aggiorna".
const CACHE = 'bankbet-v13';
const FONTS = 'bankbet-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/calc.js', 'js/sync.js', 'js/chart.js', 'js/staking.js', 'js/signals.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Font Google: cache-first, così l'app mantiene i caratteri anche offline.
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin !== location.origin) return; // API GitHub: sempre rete
  // File dell'app: sempre la versione di questa cache (niente file di versioni diverse mescolati).
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match('index.html')) || Response.error();
      }
    }),
  );
});
