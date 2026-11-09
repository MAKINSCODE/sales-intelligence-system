import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Automated tests build into their own directory so they never collide with a running dev server.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  cacheComponents: true,
  // The catalogue import is the largest upload (1 MB); the default server action body limit is 1 MB too, so allow headroom.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  partialPrefetching: true,
  serverExternalPackages: ["playwright-core"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
