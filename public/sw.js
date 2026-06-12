/* SIRAL — service worker : coquille d'app disponible hors-ligne.
 * Les données, elles, vivent déjà hors-ligne dans IndexedDB (chiffrées).
 * Stratégies :
 *  - /api/*           → réseau uniquement (jamais de cache)
 *  - navigations      → réseau d'abord, repli sur la coquille en cache
 *  - statiques (_next) → cache d'abord (immuables, hashés par le build)
 */
const SHELL_CACHE = 'siral-shell-v1'
const STATIC_CACHE = 'siral-static-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, STATIC_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return // jamais de cache sur les données

  // Navigation : réseau d'abord, repli hors-ligne sur la coquille
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Statiques : cache d'abord
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') ||
      url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.png' ||
      url.pathname === '/pdf.worker.min.mjs') {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit
        return fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
      })
    )
  }
})
