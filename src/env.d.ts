// Secrets and vars that `wrangler types` cannot see (set via `wrangler secret put`
// or .dev.vars). Merged into the generated CloudflareEnv interface.
declare global {
  interface CloudflareEnv {
    APP_URL: string;
    WEBFLOW_CLIENT_ID?: string;
    WEBFLOW_CLIENT_SECRET?: string;
    PSI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
  }
}

export {};
