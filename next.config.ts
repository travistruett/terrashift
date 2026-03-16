import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true, // This enables the stable React 19 compiler in Next 16
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
};

export default nextConfig;