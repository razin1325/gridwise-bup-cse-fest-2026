/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone for the Docker image (ignored by Vercel's builder).
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/health',
        destination: '/api/health',
      },
      {
        source: '/optimize-energy',
        destination: '/api/optimize-energy',
      },
    ];
  },
};

module.exports = nextConfig;
