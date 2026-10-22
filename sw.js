/* Offline shell only. Google responses (cross-origin) are never touched or stored,
   because Google's terms do not allow caching Places content. */
var VERSION = 'rtc-v1';
var SHELL = ['./', 'index.html', 'style.css', 'logic.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// Network first so updates arrive straight away; the cache is the fallback when offline.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () { return caches.match(req).then(function (m) { return m || caches.match('index.html'); }); })
  );
});
