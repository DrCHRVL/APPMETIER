/** @type {import('next').NextConfig} */
const nextConfig = {
  // Désactiver les source maps en production pour protéger le code source
  productionBrowserSourceMaps: false,

  // Désactiver le header X-Powered-By (masque que c'est Next.js)
  poweredByHeader: false,

  // Optimisation : output standalone pour distribution
  output: 'standalone',

  // En mode publication, builder dans un dossier séparé pour ne pas
  // casser le serveur next dev en cours d'exécution
  ...(process.env.NEXT_PUBLISH_BUILD ? { distDir: '.next-publish' } : {}),
}

export default nextConfig
