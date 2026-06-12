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
 * Stub précoce : en mode navigateur (pas d'Electron), installe une surface
 * window.electronAPI dont chaque fonction attend que le pont web soit prêt
 * (après connexion + déverrouillage E2EE) puis lui délègue l'appel.
 * Doit s'exécuter AVANT les bundles (ElectronBridge capture la disponibilité
 * de window.electronAPI au chargement de module).
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
            {/* Instantané + shim — chargés synchronement avant React */}
            <script src="./data-snapshot.js" />
            <script src="./shim.js" />
            {children}
          </>
        ) : (
          <>
            <script dangerouslySetInnerHTML={{ __html: EARLY_STUB }} />
            <WebGate>{children}</WebGate>
          </>
        )}
      </body>
    </html>
  )
}
