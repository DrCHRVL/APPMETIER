/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    unoptimized: true
  },

  // Désactiver les source maps en production pour protéger le code source
  productionBrowserSourceMaps: false,

  // Désactiver le header X-Powered-By (masque que c'est Next.js)
  poweredByHeader: false,

  // Optimisation : output standalone pour distribution
  output: 'standalone',

  // Ignorer les erreurs TypeScript et ESLint pendant le build
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // En mode publication, builder dans un dossier séparé pour ne pas
  // casser le serveur next dev en cours d'exécution
  ...(process.env.NEXT_PUBLISH_BUILD ? { distDir: '.next-publish' } : {}),

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Ne pas utiliser electron-renderer comme target car cela injecte
      // __dirname dans le bundle navigateur et provoque une erreur
      config.resolve = {
        ...config.resolve,
        fallback: {
          ...config.resolve?.fallback,
          fs: false,
          path: false,
          os: false,
          crypto: false,
          child_process: false,
        }
      };
      config.output = {
        ...config.output,
        globalObject: 'globalThis'
      };
    }
    return config;
  }
}

export default nextConfig
