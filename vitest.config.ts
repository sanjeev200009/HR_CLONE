import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test runs functions in an edge-like isolate, same as the real backend.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
  },
});
