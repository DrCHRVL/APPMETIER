/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Nécessaire pour Electron (chargement de ressources locales)
  assetPrefix: process.env.NODE_ENV === 'production' ? undefined : undefined,
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
