// Secrets that `wrangler types` cannot see (set via `wrangler secret put` or
// .dev.vars). Plain vars (APP_URL, WEBFLOW_MCP_URL, AUTH_MODE, EMAIL_FROM) come
// from the generated cloudflare-env.d.ts.
declare global {
  interface CloudflareEnv {
    ANTHROPIC_API_KEY?: string;
    RESEND_API_KEY?: string;
    // Optional: raises PageSpeed Insights quota; works without it at low volume.
    PSI_API_KEY?: string;
    // Optional: adds Perplexity to the AI visibility sample (Claude is always used).
    PERPLEXITY_API_KEY?: string;
  }
}

export {};
