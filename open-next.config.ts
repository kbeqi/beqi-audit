import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";

// KV-backed Next.js incremental cache (binding NEXT_INC_CACHE_KV). The app's
// pages are force-dynamic, so this only holds the few static route outputs.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
});
