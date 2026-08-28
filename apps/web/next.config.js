/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
      },
    ],
  },
  async rewrites() {
    return [
      // Single icon source of truth: app/icon.png (512px, content-hashed URL).
      // The old app/favicon.ico competed with it in the tab — the browser
      // painted one rendering then swapped to the other (and stale caches kept
      // serving the old ghost under /favicon.ico, which has no version query).
      // Bare /favicon.ico probes now get the same crisp PNG bytes.
      { source: '/favicon.ico', destination: '/icon.png' },
    ];
  },
}

module.exports = nextConfig
