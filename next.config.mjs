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

  // Forcer SWC pour la minification (éviter le fallback vers Terser, beaucoup plus lent)
  swcMinify: true,

  // Production silencieuse : les console.log/info disparaissent du bundle
  // (les warn/error restent pour le diagnostic)
  compiler: {
    removeConsole: { exclude: ['error', 'warn'] },
  },

  experimental: {
    // Limiter les workers de build
    cpus: 2,
    // Exclure du file tracing les packages jamais importés par le serveur Next
    // (pdf-parse : scripts attaché hors Next ; pdfjs-dist : chargé côté client)
    // - évite que le build bloque sur le tracing
    outputFileTracingExcludes: {
      '*': [
        './node_modules/pdf-parse/**',
        './node_modules/pdfjs-dist/**',
      ],
    },
  },

  // Ignorer les erreurs TypeScript et ESLint pendant le build
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Neutraliser les modules Node.js dans le bundle navigateur
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
