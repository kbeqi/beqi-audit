# Beqi Audit

Internal tool for Beqi (Webflow agency): scheduled audits of client Webflow sites, a portfolio dashboard, and (later) agent-proposed fixes applied through the Webflow MCP server after human approval.

Product plan and decisions: https://claude.ai/artifact/6Jk9ecpqjTpJANLi2a2VjM

## Stack

- Next.js 16 (App Router, `src/app`) on Cloudflare Workers via `@opennextjs/cloudflare`. `worker.ts` wraps the OpenNext handler and adds the cron `scheduled` handler and the Workflow class.
- Cloudflare D1 (SQLite) through Drizzle (`src/db/schema.ts`). Migrations in `drizzle/`, applied with wrangler (`npm run db:migrate:local|remote`).
- Cloudflare Workflows run audits (`src/audit/workflow.ts`); the same step functions in `src/audit/runner.ts` also run inline when no Workflow binding exists (local `next dev`).
- R2 (`AUDIT_STORE`) holds per-run JSON artifacts under `runs/<runId>/*.json`; D1 holds findings, scores and lifecycle.
- Cloudflare Access protects the app; the actor email comes from `cf-access-authenticated-user-email` (`src/lib/auth.ts`).
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before using an API you are unsure about. `cacheComponents` is off on purpose; pages are `force-dynamic`.

## Conventions

- Deterministic code decides what is broken; the model (phase 5) only explains, prioritizes and drafts fixes. Never add a check whose verdict depends on an LLM.
- Nothing writes to a client's Webflow site without a row in `fix_proposals` with status `approved`, and every write is logged in `audit_log`.
- A finding's identity across runs is its `fingerprint` = sha256(checkId | pagePath | subject). Keep check ids stable (`<category>.<kebab-name>`); renaming one resets lifecycle state.
- Severity scale: critical / high / medium / low / info. Scores are per category (`src/audit/score.ts`), weighted into an overall 0–100.
- Checks live in `src/audit/checks/<category>.ts` and are pure functions of `AnalysisInput`. Add new data sources to the runner steps, not to the checks.
- Keep Workflow step return values small; persist large data to R2 inside the step.
- D1 limits bound parameters per statement: insert findings in chunks (see `stepAnalyze`).

## Commands

- `npm run dev` — Next dev server with local Cloudflare bindings (D1/R2 via Miniflare; audits run inline).
- `npm run preview` — OpenNext build + `wrangler dev` (closest to production: Workflows and cron work here; trigger cron with `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"`).
- `npm run deploy` — build and deploy.
- `npm run typecheck`, `npm run lint`, `npm run cf-typegen` (after editing `wrangler.jsonc`).
- `npm run db:generate` after changing `src/db/schema.ts`, then `npm run db:migrate:local`.
- `npm run smoke -- <url> [maxPages] [--psi]` — run crawler + checks against any site with no DB or Webflow token. `node scripts/fixture-server.mjs 8099` serves a fake Webflow site for this.

## Secrets (wrangler secret put / .dev.vars)

`WEBFLOW_CLIENT_ID`, `WEBFLOW_CLIENT_SECRET` (OAuth app; redirect URI `<APP_URL>/api/webflow/callback`), optional `PSI_API_KEY`, optional `ANTHROPIC_API_KEY`. `APP_URL` is a plain var in `wrangler.jsonc`.
