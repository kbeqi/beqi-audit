# Beqi Audit

Claude audits Beqi's client Webflow sites on a schedule, proposes fixes, and applies the ones you approve. Runs on Cloudflare (Workers, D1, KV, Workflows, cron) and talks to Webflow through Webflow's hosted MCP server.

## How it works

1. Add a client, then **Connect Webflow**: a Beqi team member authorizes the app against Webflow's MCP server once per workspace (OAuth; no Webflow Marketplace app). Every site in the workspace is imported and scheduled weekly.
2. The hourly cron starts a Workflow for every site that is due. Claude reads the site through Webflow's data tools (pages, SEO, schema, scripts, assets, sitemap flags) and the live URL, works through a fixed catalog of checks, and writes a report. The report is validated into findings and fix proposals, scored, and diffed against the previous audit (new / still open / resolved).
3. The dashboard shows each site's score, trend and open issues; the site page shows Claude's summary, open findings, and proposed fixes. **Approve & apply** hands one proposal to the fix agent, which reads the current value, writes the change, reads it back, and reports. Changes to page settings, schema and code go live on the site's next publish.

## Local development

```bash
cp .dev.vars.example .dev.vars        # add ANTHROPIC_API_KEY
npm install
npm run db:migrate:local
npm run preview                       # http://localhost:8787 (Workflows + cron)
# or: npm run dev                     # http://localhost:3000 (audits run inline)
```

## Deploy

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npm run db:migrate:remote             # when drizzle/ changed
npm run deploy
```

The Worker is `beqi-audit-app` (`beqi-audit` is the public Site Check widget). `APP_URL` in `wrangler.jsonc` must be the deployed URL: the Webflow MCP OAuth redirect URI is `<APP_URL>/api/webflow/callback`.

### Protect it with Cloudflare Access

The app has no login of its own. In Zero Trust → Access → Applications, add a self-hosted application for the Worker's hostname with a policy that allows Beqi emails, then set `AUTH_MODE` to `access` in `wrangler.jsonc` and redeploy. Until then `AUTH_MODE=open` serves everyone and the UI shows a warning banner.
