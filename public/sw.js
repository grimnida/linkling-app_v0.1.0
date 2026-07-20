/* Linkling PWA 앱 셸 서비스 워커.
 * 앱 셸만 캐시한다. 단어팩 콘텐츠는 WordpackCache(IndexedDB + Cache Storage)가 관리하며
 * versioned 경로라 immutable 캐시가 안전하다. */
const SHELL_CACHE = 'linkling-shell-v1';
const CONTENT_CACHE = 'linkling-content-v1'; // WordpackCache와 공유

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest', '/icon.svg'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== CONTENT_CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 앱 셸: network-first(index), cache-first(해시 자산)
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/assets/')) {
      e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(e.request, clone));
        return res;
      })));
    } else if (e.request.mode === 'navigate') {
      e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    }
    return;
  }
  // cross-origin 팩 자산: versioned 경로만 cache-first (오프라인 재접속 지원)
  if (/\/packs\/.+\//.test(url.pathname)) {
    e.respondWith(caches.open(CONTENT_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
  }
});
