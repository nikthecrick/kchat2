import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  // These were both set to `true`, which is almost certainly why the broken
  // WebAuthn import and the incompatible socket route went unnoticed for so
  // long. Real type errors should fail the build.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  reactStrictMode: false,

  // Hide the Next.js dev-tools badge (the "N" that offers to try Turbopack).
  // Development-only overlay; compile and runtime errors are still reported.
  devIndicators: false,

  serverExternalPackages: [
    '@simplewebauthn/server',
    'jsonwebtoken',
    '@prisma/client',
    'tweetnacl',
  ],
};

export default nextConfig;