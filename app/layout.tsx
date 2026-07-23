import './globals.css'
import './print.css'
import type { Metadata } from 'next'
import { WebGate } from '@/components/web/WebGate'
import { ELECTRON_API_NAMES } from '@/lib/web/apiNames'

export const metadata: Metadata = {
  title: 'SIRAL',
  description: 'SIRAL — Suivi Intégré des Réseaux criminels et Affaires Liées',
  manifest: '/manifest.webmanifest',
  themeColor: '#1c3a2c',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
  appleWebApp: {
    capable: true,
    title: 'SIRAL',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/favicon.png',
    apple: '/icons/apple-touch-icon.png',
  },
}

const IS_CONSULTATION = process.env.NEXT_PUBLIC_CONSULTATION === '1'

/**
 * Stub précoce : installe la surface window.electronAPI (pont de données —
 * nom hérité de l'ancienne édition bureau) dont chaque fonction attend que
 * le pont web soit prêt (après connexion + déverrouillage E2EE) puis lui
 * délègue l'appel. Doit s'exécuter AVANT les bundles (ElectronBridge capture
 * la disponibilité de window.electronAPI au chargement de module).
 */
const EARLY_STUB = `(function(){
  if (window.electronAPI) return;
  window.__SIRAL_WEB__ = true;
  var resolveBridge;
  var ready = new Promise(function(res){ resolveBridge = res; });
  window.__SIRAL_BRIDGE_SET__ = function(bridge){ window.__SIRAL_BRIDGE__ = bridge; resolveBridge(bridge); };
  var names = ${JSON.stringify(ELECTRON_API_NAMES)};
  var api = {};
  names.forEach(function(name){
    api[name] = function(){
      var args = arguments;
      if (window.__SIRAL_BRIDGE__) return window.__SIRAL_BRIDGE__[name].apply(null, args);
      return ready.then(function(bridge){ return bridge[name].apply(null, args); });
    };
  });
  window.electronAPI = api;
})();`

/**
 * Auto-réparation « app installée » (PWA écran d'accueil iPhone/Android).
 * Symptôme : l'app lancée depuis l'icône du bureau plante ("client-side
 * exception") alors que Safari fonctionne. Cause : après une mise à jour, la
 * coquille en cache (service worker) référence des morceaux JS (_next/static,
 * imports dynamiques) qui ne correspondent plus → ChunkLoadError → React ne
 * peut pas s'hydrater. Safari, lui, charge un bundle cohérent depuis le réseau.
 *
 * Remède : au premier ChunkLoadError, on purge les caches + on désinscrit le
 * service worker, puis un SEUL rechargement (verrou de session anti-boucle).
 * Le lancement suivant repart sur un bundle frais et cohérent.
 */
const CHUNK_SELF_HEAL = `(function(){
  var FLAG = '__siral_chunk_heal__';
  function looksLikeChunkError(msg, name){
    if (name === 'ChunkLoadError') return true;
    if (typeof msg !== 'string') return false;
    return msg.indexOf('ChunkLoadError') !== -1
      || msg.indexOf('Loading chunk') !== -1
      || msg.indexOf('Loading CSS chunk') !== -1
      || msg.indexOf('Importing a module script failed') !== -1
      || msg.indexOf('error loading dynamically imported module') !== -1;
  }
  var healing = false;
  function heal(){
    if (healing) return;
    healing = true;
    try {
      if (sessionStorage.getItem(FLAG)) return; // déjà tenté cette session → on évite la boucle
      sessionStorage.setItem(FLAG, '1');
    } catch(e){}
    var reload = function(){ try { location.reload(); } catch(e){} };
    var clearedCaches = (window.caches && caches.keys)
      ? caches.keys().then(function(keys){
          return Promise.all(keys.map(function(k){ return caches.delete(k); }));
        }).catch(function(){})
      : Promise.resolve();
    var unregistered = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
      ? navigator.serviceWorker.getRegistrations().then(function(regs){
          return Promise.all(regs.map(function(r){ return r.unregister(); }));
        }).catch(function(){})
      : Promise.resolve();
    Promise.all([clearedCaches, unregistered]).then(reload, reload);
  }
  window.addEventListener('error', function(e){
    var err = e && e.error;
    if (looksLikeChunkError((e && e.message) || (err && err.message), err && err.name)) heal();
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    if (looksLikeChunkError((r && r.message) || String(r || ''), r && r.name)) heal();
  });
})();`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" data-readonly={IS_CONSULTATION ? 'true' : undefined}>
      <body>
        {IS_CONSULTATION ? (
          <>
            {/* Instantané + shim — volontairement synchrones : doivent être
                exécutés dans l'ordre, avant l'hydratation de React. */}
            {/* eslint-disable-next-line @next/next/no-sync-scripts */}
            <script src="./data-snapshot.js" />
            {/* eslint-disable-next-line @next/next/no-sync-scripts */}
            <script src="./shim.js" />
            {children}
          </>
        ) : (
          <>
            <script dangerouslySetInnerHTML={{ __html: CHUNK_SELF_HEAL }} />
            <script dangerouslySetInnerHTML={{ __html: EARLY_STUB }} />
            <WebGate>{children}</WebGate>
          </>
        )}
      </body>
    </html>
  )
}
