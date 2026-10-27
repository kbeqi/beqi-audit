// Secrets that `wrangler types` cannot see (set via `wrangler secret put` or
// .dev.vars). Plain vars (APP_URL, WEBFLOW_MCP_URL, AUTH_MODE) come from the
// generated cloudflare-env.d.ts.
declare global {
  interface CloudflareEnv {
    ANTHROPIC_API_KEY?: string;
  }
}

export {};
