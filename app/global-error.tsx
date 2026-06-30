'use client'

/**
 * Filet de sécurité de dernier recours (root layout error boundary).
 *
 * `app/error.tsx` ne couvre que les erreurs survenant DANS la page. Les
 * exceptions lancées par le layout racine lui-même — y compris par la porte
 * d'entrée web `WebGate` qui y est montée — remontent ici. Sans ce fichier,
 * elles produisent l'écran blanc générique de Next.js. `global-error` doit
 * fournir ses propres balises <html>/<body> car il remplace tout le document.
 */
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[SIRAL] Exception fatale côté client :', error)
  }, [error])

  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(900px 600px at 30% 20%, #224636, #0e1c14 70%)',
            fontFamily: "Inter, 'Segoe UI', sans-serif",
            padding:
              'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
          }}
        >
          <div
            style={{
              width: 420,
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: 'calc(100vh - 32px)',
              overflowY: 'auto',
              background: '#fbfcfb',
              borderRadius: 18,
              padding: '28px 26px 22px',
              boxShadow: '0 30px 70px rgba(0,0,0,.5)',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 800, color: '#15201b', marginBottom: 6 }}>
              SIRAL — une erreur est survenue
            </div>
            <div style={{ fontSize: 13.5, color: '#5b6b63', lineHeight: 1.5, marginBottom: 14 }}>
              L&apos;application n&apos;a pas pu démarrer. Réessayez ; si le problème persiste,
              transmettez le détail ci-dessous au support.
            </div>
            <div
              style={{
                background: '#fde8e8',
                color: '#b91c1c',
                borderRadius: 9,
                padding: '10px 12px',
                fontSize: 12,
                lineHeight: 1.45,
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              {error?.message || 'Erreur inconnue'}
              {error?.digest && (
                <div style={{ marginTop: 6, opacity: 0.7 }}>réf. {error.digest}</div>
              )}
            </div>
            <button
              onClick={() => reset()}
              style={{
                width: '100%',
                background: '#1c3a2c',
                color: '#fff',
                border: 'none',
                borderRadius: 11,
                padding: '13px 16px',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: 'pointer',
                marginTop: 14,
              }}
            >
              Réessayer
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                width: '100%',
                background: '#fff',
                color: '#15201b',
                border: '1px solid #e3e8e4',
                borderRadius: 11,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: 8,
              }}
            >
              Recharger la page
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
