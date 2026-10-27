import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes Cloudflare bindings (D1, R2, Workflows, ...) available to `next dev`
// through getCloudflareContext(), backed by local Miniflare state.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // Every page in this app reads live audit data; the Cache Components model
  // adds friction without benefit for an internal dashboard.
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
