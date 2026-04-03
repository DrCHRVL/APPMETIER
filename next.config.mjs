/** @type {import('next').NextConfig} */
const nextConfig = {
  // Désactiver les source maps en production pour protéger le code source
  productionBrowserSourceMaps: false,

  // Désactiver le header X-Powered-By (masque que c'est Next.js)
  poweredByHeader: false,

  // Optimisation : output standalone pour distribution
  output: 'standalone',
}

export default nextConfig
