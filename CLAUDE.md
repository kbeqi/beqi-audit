# Beqi Audit

Internal tool for Beqi (Webflow agency): Claude audits client Webflow sites on a schedule through Webflow's hosted MCP server, proposes fixes, and applies the ones a human approves. Portfolio dashboard, per-site findings with lifecycle, live agent activity log.

## Stack

- Next.js 16 (App Router, `src/app`; `(app)` is the signed-in shell, `(public)` holds sign-in and shared reports) on Cloudflare Workers via `@opennextjs/cloudflare`. `worker.ts` wraps the OpenNext handler and adds the cron `scheduled` handler and the Workflow class.
- Cloudflare D1 (SQLite) through Drizzle (`src/db/schema.ts`). Migrations in `drizzle/`, applied with wrangler (`npm run db:migrate:local|remote`).
- Cloudflare Workflows run audits and approved fixes (`src/audit/workflow.ts`, one class, `params.kind` = `audit` | `fix`); the same functions run inline when no Workflow binding exists (local `next dev`).
- Workers KV (`AUDIT_STORE`) holds per-run artifacts: the structured report, the report text and the full agent transcript under `runs/<runId>/*.json` (90-day TTL). D1 holds findings, scores, proposals, lifecycle and the activity log (`run_events`).
- Auth (`src/lib/auth.ts`): `AUTH_MODE=app` (default) is in-app sign-in by one-time email link (`/login` → `requestSignIn` → `/api/auth/callback`), 30-day session cookie `beqi_session` backed by the `sessions` table (revocable). Only `users` rows (Team page, admins only) and `ADMIN_EMAILS` can sign in; configured admins are auto-created and can't be demoted or removed. Every page calls `requireSignedIn()` (`src/app/gate.tsx`); actions call `currentActor()` / `requireAdmin()`. `AUTH_MODE=access` trusts Cloudflare Access's header instead (must still be a team member); `open` is bring-up only.
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before using an API you are unsure about. `cacheComponents` is off on purpose; pages are `force-dynamic`.

## The engine (`src/agent`)

- `audit.ts`: one streamed `claude-opus-5-5` conversation (adaptive thinking, effort high, server-side fallbacks) with Webflow's MCP server attached through the Anthropic MCP connector (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2026-09-15`) and `web_fetch` scoped to the site's host. Content blocks are mirrored into `run_events` as they complete. A second, tool-free `messages.parse` call turns the written report into `AuditReportSchema` (zod).
- `catalog.ts`: the fixed list of check ids the agent may report (`<category>.<kebab-name>`), their default severity and the fix action each supports. The zod schema enumerates these ids, so the model cannot invent checks. A finding's identity across runs is `fingerprint` = sha256(checkId | pagePath | subject); renaming an id resets lifecycle state.
- `webflow-mcp.ts`: the tool allow-list handed to the connector, and the read/write classifier. Webflow's tools are coarse (`data_pages_tool` with an `action`), so the audit run is also checked after the fact: any write action fails the run.
- `fix.ts`: applies one approved `fix_proposals` row; reads the current value first, skips if it drifted from the proposal's `from`, writes, reads back, returns `FixResultSchema`.
- `prompts.ts`: static system prompts (cached) + per-task user prompts. Site-specific data never goes in the system prompt.

## Conventions

- Nothing writes to a client's Webflow site except the fix agent, only for a `fix_proposals` row with status `approved`, and every outcome is logged in `audit_log`.
- Severity scale: critical / high / medium / low / info. Scores are per category (`src/audit/score.ts`), weighted into an overall 0–100, computed deterministically from the findings.
- Keep Workflow step return values small; persist large data to KV (`AUDIT_STORE`) inside the step.
- D1 limits bound parameters per statement: insert findings in chunks (see `stepAnalyze`).
- Webflow MCP auth (`src/lib/webflow/mcp-oauth.ts`): OAuth against the MCP server using the MCP SDK's `auth()` helper (discovery, dynamic client registration, PKCE, refresh). No Webflow Marketplace app. The registered client is cached in KV; tokens live on `webflow_connections`.
- UI: tokens in `src/app/globals.css` (light and dark are both chosen values; `--*-text` variants are the contrast-safe colours for text, the bare tokens are for fills), components in `src/components/ui.tsx`. Status colors only mean good/warning/serious/critical and always come with a text label.
- Navigation model: Portfolio → Clients → one client's hub (`/clients/[id]` with Overview / Audits / Fixes / Sites / Settings tabs, shared `layout.tsx` header with logo-or-name and Audit now) → site, run and fix pages, whose breadcrumbs lead back into the hub. `/runs` and `/fixes` are cross-client views reachable from the portfolio only.

## Commands

- `npm run dev` — Next dev server with local Cloudflare bindings (D1/KV via Miniflare; audits run inline).
- `npm run preview` — OpenNext build + `wrangler dev` on :8787 (closest to production: Workflows and cron work here; trigger cron with `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"`).
- `npm run deploy` — build and deploy. Run `npm run db:migrate:remote` first when `drizzle/` changed.
- `npm run typecheck`, `npm run lint`, `npm run cf-typegen` (after editing `wrangler.jsonc`).
- `npm run db:generate` after changing `src/db/schema.ts`, then `npm run db:migrate:local`.
- `node scripts/ux-check.mjs [baseUrl] [loginToken]` — orientation (one h1, page titles, breadcrumbs, active nav/tab), labels, axe serious/critical, no horizontal overflow, at desktop and phone widths. Seed a `login_tokens` row and pass its raw token.
- `npm run test:links [baseUrl]` — (set `LINKCHECK_COOKIE=beqi_session=<token>` when sign-in is enforced) crawls the running app (default :8787) and fails on any link that doesn't resolve, hits the error/not-found page, or whose entity label doesn't match the destination heading. Run it against the preview with seed data and against the live URL after a deploy.

## Secrets and vars

Secrets (`wrangler secret put` / `.dev.vars`): `ANTHROPIC_API_KEY`; `RESEND_API_KEY` for sign-in links and client emails (without it every email is recorded as skipped in `audit_log`, and nobody new can sign in). Vars in `wrangler.jsonc`: `APP_URL`, `WEBFLOW_MCP_URL`, `AUTH_MODE`, `ADMIN_EMAILS`, `EMAIL_FROM`.

## Shared reports

`shareRun` puts a random token on `runs.share_token`; `/share/<token>` (public layout, `noindex`) renders `src/components/report.tsx` from `sharedReport()`, which exposes no proposals, ids, costs or actions. `unshareRun` clears the token. The brand mark lives in `src/components/brand.tsx` and `src/app/icon.svg` (favicon).

## Client emails (`src/lib/email.ts`)

Per client: `notify_email` (comma-separated), `notify_reminder`, `notify_results`. The hourly scheduler sends one reminder per upcoming scheduled audit (`sites.reminder_sent_for` guards it, set before sending); `stepFinalize` sends results on a complete run. Sending goes through Resend's HTTP API and never throws; outcomes are `email.sent|skipped|failed` rows in `audit_log`.
