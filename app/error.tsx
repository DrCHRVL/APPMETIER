'use client'

/**
 * Page de secours (error boundary) au niveau de la racine de l'application.
 *
 * Sans ce fichier, la moindre exception lancée par un composant pendant le
 * rendu remplace toute l'interface par l'écran blanc générique de Next.js
 * (« Application error: a client-side exception has occurred »), sans aucune
 * indication exploitable.
 *
 * Ici, on intercepte l'erreur, on la journalise dans la console et on affiche
 * le message réel (même en production) avec un bouton pour relancer le rendu
 * et un autre pour recharger complètement la page. Cela rend les pannes —
 * notamment celles spécifiques au mobile — diagnosticables au lieu d'opaques.
 */
import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Trace complète dans la console (utile sur mobile via le débogueur distant)
    console.error('[SIRAL] Exception côté client :', error)
  }, [error])

  return (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'linear-gradient(140deg,#4d8a6c,#2B5746)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 21,
              fontWeight: 700,
              fontFamily: 'Georgia, serif',
            }}
          >
            S
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#15201b' }}>SIRAL</div>
            <div style={{ fontSize: 11, color: '#5b6b63' }}>Une erreur est survenue</div>
          </div>
        </div>

        <div style={{ fontSize: 13.5, color: '#5b6b63', lineHeight: 1.5, marginBottom: 14 }}>
          L&apos;application a rencontré un problème et n&apos;a pas pu s&apos;afficher. Vous pouvez
          réessayer ; si le problème persiste, transmettez le détail ci-dessous au support.
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
  )
}
