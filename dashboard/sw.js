/**
 * sw.js — the service worker
 * ---------------------------------------------------------------------
 * Makes the installed app open instantly and work offline. The pages,
 * scripts, styles, icons and libraries are kept on the device and served
 * from there; your data already is (data.js), so nothing has to come
 * over the network to draw the dashboard. Supabase requests always go
 * to the network and are never stored here.
 *
 * Only the deployed site uses this: scripts/dashboard/build.mjs fills in
 * VERSION and PRECACHE (every file in that build, content-hashed) and
 * switches on its registration in each page. Each deploy is a new
 * version: it downloads alongside the old one, takes over, then the old
 * one's files are deleted, so a page never mixes files from two deploys.
 * New pages appear from the next launch after a deploy.
 * ---------------------------------------------------------------------
 */

const VERSION = '__VERSION__';
const PRECACHE = [/* __PRECACHE__ */];

const APP_CACHE = `ledger-app-${VERSION}`;
const FONT_CACHE = 'ledger-fonts';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// The new version takes over open pages, and the previous version's files are cleared out.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('ledger-app-') && name !== APP_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net') event.respondWith(cacheFirst(request));
  else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') event.respondWith(fonts(request, event));
  // Anything else (Supabase: data, sign-in, storage) goes straight to the network.
});

/**
 * Pages come from this version's copy, whatever's after the "?" (sign-in
 * returns to index.html?code=…), so the app opens without the network.
 */
async function page(request) {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch (error) {
    return (await cache.match('index.html')) || Response.error();
  }
}

/** Built files and pinned library versions never change once published, so a stored copy is always right. */
async function cacheFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** Fonts: the stored copy straight away, refreshed in the background for next time. */
async function fonts(request, event) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}
