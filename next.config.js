/** @type {import('next').NextConfig} */
const nextConfig = {
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
