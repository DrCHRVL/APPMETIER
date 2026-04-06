const nextConfig = {
  reactStrictMode: false,
  images: {
    unoptimized: true
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.target = 'electron-renderer';
      // Ajout de cette configuration
      config.output = {
        ...config.output,
        globalObject: 'globalThis'
      };
    }
    return config;
  }
}