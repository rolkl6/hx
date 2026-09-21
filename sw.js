/* 滑雪计时 · Service Worker（离线缓存） */
const VERSION = 'v1.1.0';
const CACHE = 'ski-timer-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      )
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* 页面导航：网络优先，失败回退到缓存里的首页（保证离线可开） */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', res.clone()).catch(() => {});
        }
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) ||
          (await cache.match('./')) ||
          new Response('离线且无缓存', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  /* 静态资源：缓存优先 + 后台更新 */
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetch(req).then((res) => {
        if (res && res.ok) {
          caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      return new Response('离线且无缓存', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
