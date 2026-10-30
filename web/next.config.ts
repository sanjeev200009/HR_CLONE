import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents (on by default in the Next 16 template) prerenders client
  // components and fails on any runtime-only hook. Every page here sits behind
  // Clerk auth and renders from live Convex queries, so there is nothing to
  // prerender — Clerk's own <SignIn> uses usePathname and cannot be static.
  // Turning it off once beats `export const instant = false` in seven route files.
  cacheComponents: false,
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
