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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body>
        {children}
      </body>
    </html>
  )
}