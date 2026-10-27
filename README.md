# Beqi Audit

Scheduled audits of Beqi's client Webflow sites: SEO, AEO/GEO, performance, broken links, unused CSS and scripts, and naming hygiene, with a portfolio dashboard and per-site findings. Runs on Cloudflare (Workers, D1, R2, Workflows, cron triggers).

## How it works

1. Add a client, then **Connect Webflow**: the client (or you, in their workspace) authorizes Beqi's OAuth app once per workspace. Every authorized site is imported, scheduled weekly, and gets a `site_publish` webhook.
2. The hourly cron starts a Workflow for every site that is due. A run: pulls pages, scripts and custom code from the Webflow Data API → crawls the published site → checks every link → runs PageSpeed Insights on the key pages → runs all checks → scores, diffs against the previous run, and records finding lifecycle (new / still open / fixed).
3. The dashboard shows each site's score, trend and open issues; the site page shows category scores, PageSpeed metrics, open findings (ignore / not-an-issue), run history and settings.

## Local development

```bash
cp .dev.vars.example .dev.vars        # fill in Webflow OAuth credentials
npm install
npm run db:migrate:local
npm run dev                           # http://localhost:3000, audits run inline
```

For the production-like path (Workflows + cron):

```bash
npm run preview                       # http://localhost:8787
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"   # fire the scheduler
```

Try the checks without any credentials:

```bash
node scripts/fixture-server.mjs 8099 &
npm run smoke -- http://localhost:8099 30
```

## First deploy

Already done on the Beqi Cloudflare account (27 Oct 2026): the D1 database `beqi-audit` (id in `wrangler.jsonc`) exists with migration `0000` applied. The Worker is named `beqi-audit-app` because `beqi-audit` is the public Site Check widget Worker.

Still needed, in order:

1. Enable R2 once in the Cloudflare dashboard (R2 → Get started; it asks for a payment method even on the free tier). Then:
   ```bash
   npx wrangler login
   npx wrangler r2 bucket create beqi-audit-opennext-cache
   npx wrangler r2 bucket create beqi-audit-store
   ```
2. Secrets and deploy:
   ```bash
   npx wrangler secret put WEBFLOW_CLIENT_ID
   npx wrangler secret put WEBFLOW_CLIENT_SECRET
   npx wrangler secret put PSI_API_KEY        # optional
   npm run deploy
   ```
3. Later schema changes: `npm run db:generate` then `npm run db:migrate:remote` (the `d1_migrations` table already records `0000`).

Then set `APP_URL` in `wrangler.jsonc` to the deployed URL (or custom domain), add `<APP_URL>/api/webflow/callback` as the redirect URI on the Webflow app, and redeploy.

### Protect it with Cloudflare Access

The app has no login of its own. In Zero Trust → Access → Applications, add a self-hosted application for the Worker's hostname with a policy that allows Beqi emails. Access injects `cf-access-authenticated-user-email`, which the app records as the actor on every action. Exclude `/api/webhooks/*` from the Access policy (Webflow must reach it; the request is HMAC-verified with the OAuth client secret).

### Webflow app

Create an app in the Webflow dashboard (Apps & integrations → Build an app) with the scopes listed in `src/lib/webflow/oauth.ts` and the redirect URI above. Clients authorize it per workspace; the app only needs the Data API, so no Designer extension is required.

## Roadmap

See the plan document for phases. Next up: Browser Rendering screenshots and visual diff, Analyze/AEO reports for Enterprise sites, scheduled PDF reports, and the approval-gated fix agent via the Webflow MCP server.
