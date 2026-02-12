import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/auth/:path*',
        destination: '/auth/:path*',
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: 'https://oxy.so',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        // FedCM manifest - must be accessible cross-origin
        source: '/fedcm.json',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
      {
        // Well-known web-identity file for FedCM discovery
        source: '/.well-known/web-identity',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
    ];
  },
};

export default nextConfig;
