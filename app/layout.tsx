import './globals.css'
import './print.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Enquêtes Statistiques',
  description: 'Application de gestion des enquêtes',
  icons: {
    icon: '/favicon.png'
  }
}

const IS_CONSULTATION = process.env.NEXT_PUBLIC_CONSULTATION === '1'

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
          </>
        ) : null}
        {children}
      </body>
    </html>
  )
}