import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeClient, requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { getDb } from "@/db";
import type { Severity } from "@/db/schema";
import { FREQUENCY_LABELS } from "@/db/schema";
import { clientDetail, primarySite, siteChanges, siteDetail } from "@/lib/queries";
import { statsSummary } from "@/lib/google/sync";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { CategorySections } from "@/components/category-sections";
import { FixFirst } from "@/components/fix-first";
import { AreaTable } from "@/components/area-table";
import { Markdown } from "@/components/markdown";
import { PerformanceCard } from "@/components/insights";
import { InventoryCard } from "@/components/inventory-card";
import { TrafficCard } from "@/components/traffic-card";
import { Card, EmptyState, Notice, ScoreRing, Sparkline, StatusPill, btnSecondary, fmtCost, fmtDate, fmtDay, fmtDuration, timeAgo } from "@/components/ui";
import { SEVERITY_ORDER } from "@/audit/score";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "Client" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Home` : "Client" };
}

function headline(score: number | null | undefined): string {
  if (score == null) return "Your site has not been audited yet";
  if (score >= 90) return "Your site is in good shape";
  if (score >= 75) return "Your site is doing well, with a few things to fix";
  if (score >= 55) return "Your site needs some work";
  return "Your site needs attention";
}

// The client's home answers three questions in order: how is my site, what
// changed since last time, what do you need from me. Then every area, the
// summary, what it is doing for them, and the history.
export default async function ClientHome({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch & { sev?: string }> }) {
  const { id } = await params;
  const team = isTeam(await requireClientAccess(id, `/clients/${id}`));
  const role = team ? "team" : "client";
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections, pendingFixes } = data;
  const site = primarySite(sites.map((s) => s.site));
  const detail = site ? await siteDetail(site.id) : null;
  const active = connections.filter((c) => !c.revokedAt);
  const base = `/clients/${client.id}`;
  const waiting = team ? pendingFixes : pendingFixes.filter((p) => p.status === "proposed");

  if (!site || !detail) {
    return (
      <div className="space-y-6">
        <ClientNotices q={q} />
        <Card>
          <EmptyState
            title={team ? "No site yet" : "Your site is being set up"}
            body={team ? (active.length ? "The connected workspace returned no site. Use “Re-import” in Settings, or choose the site when the workspace has several." : "Connect the client's Webflow workspace in Settings; the site is imported from it.") : "Beqi is connecting your Webflow site. Your first audit appears here once it has run."}
            action={
              team ? (
                <Link href={`${base}/settings`} className={btnSecondary}>
                  Go to Settings
                </Link>
              ) : undefined
            }
          />
        </Card>
      </div>
    );
  }

  const { connection, runs, latest, previous, findings, stateByFp, proposals, metrics, stats, fixedPages, googleConnection } = detail;
  const db = await getDb();
  const changes = latest ? await siteChanges(site.id, 1) : null;
  const latestChanges = changes?.audits[0];
  let traffic: Awaited<ReturnType<typeof statsSummary>> | null = null;
  if (site.gscProperty || site.ga4Property) {
    const x = await statsSummary(db, site.id);
    if (x.hasData) traffic = x;
  }
  const running = runs.find((r) => r.status === "running" || r.status === "queued") ?? null;
  const history = runs.filter((r) => r.status === "complete").map((r) => r.scoreOverall).reverse().slice(-12);
  const severity = (SEVERITY_ORDER as string[]).includes(q.sev ?? "") ? (q.sev as Severity) : "all";
  const newFps = new Set(findings.filter((f) => stateByFp.get(f.fingerprint)?.firstSeenRunId === latest?.id).map((f) => f.fingerprint));
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const delta = latest?.scoreOverall != null && previous?.scoreOverall != null ? latest.scoreOverall - previous.scoreOverall : null;
  const scoreLine = latest ? (delta == null ? `First audit, ${fmtDay(latest.finishedAt)}` : delta === 0 ? `Unchanged since ${fmtDay(previous!.finishedAt)}` : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since ${fmtDay(previous!.finishedAt)}`) : "No audit yet";
  const fixedSince = latest?.summary?.resolvedFindings ?? 0;
  const foundSince = latest?.summary?.newFindings ?? 0;
  const pct = (now: number, before: number) => (before ? `${now >= before ? "Up" : "Down"} ${Math.abs(Math.round(((now - before) / before) * 100))}%` : null);
  const aiNow = latest?.summary?.aiVisibility && latest.summary.aiVisibility.answers > 0 ? latest.summary.aiVisibility : null;
  const quickWaiting = waiting.filter((p) => p.effort === "quick").length;

  return (
    <div className="space-y-10">
      <ClientNotices q={q} />
      {team && !connection && (
        <Notice tone="warn">
          The site has no active Webflow connection.{" "}
          <Link href={`${base}/settings`} className="font-medium underline">
            Reconnect the workspace in Settings
          </Link>{" "}
          to audit it.
        </Notice>
      )}

      {/* 1. How is my site? */}
      <section aria-labelledby="state" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-ink-3">
              {latest ? `${latest.trigger === "publish" ? "Checked after a publish" : "Audited"} · ${fmtDate(latest.finishedAt)}` : connection ? "Ready for the first audit" : "Not connected yet"}
              {running && (
                <>
                  {" · "}
                  <Link href={`/runs/${running.id}`} className="text-accent underline">
                    <StatusPill status="running" /> audit in progress
                  </Link>
                </>
              )}
            </p>
            <h1 id="state" className="mt-1 text-2xl font-semibold tracking-tight text-ink">
              {headline(latest?.scoreOverall)}
            </h1>
          </div>
          {latest && previous && (
            <Link href={`${base}/changes`} className="text-sm font-medium text-accent hover:underline">
              What changed since {fmtDay(previous.finishedAt)} →
            </Link>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="flex items-center gap-5 p-5">
            <ScoreRing score={latest?.scoreOverall} size="xl" />
            <div className="text-sm leading-relaxed">
              <div className="font-semibold text-ink">Site score</div>
              <div className="text-ink-2">out of 100</div>
              <div className="mt-1 text-ink-3">{scoreLine}</div>
              {history.length >= 2 && (
                <div className="pt-1">
                  <Sparkline values={history} width={120} height={26} title="Score over the last audits" />
                </div>
              )}
            </div>
          </Card>
          <Card className="flex flex-col gap-1.5 p-5">
            <div className="text-xs text-ink-3">Open issues</div>
            <div className="text-3xl font-bold leading-none tracking-tight text-ink num">{findings.length}</div>
            <div className="text-sm leading-relaxed text-ink-2">
              {latest ? (
                <>
                  {fixedSince > 0 ? <span className="font-semibold text-good-text">{fixedSince} fixed</span> : "Nothing fixed"} and {foundSince} found since the last audit. {counts.critical ? `${counts.critical} critical.` : "None critical."}
                </>
              ) : (
                "Appears after the first audit."
              )}
            </div>
          </Card>
          <Card className={`flex flex-col gap-1.5 p-5 ${waiting.length ? "border-accent/40 bg-accent/5" : ""}`}>
            <div className="text-xs text-ink-3">{team ? "Fixes to review" : "Waiting for you"}</div>
            <div className="text-3xl font-bold leading-none tracking-tight text-ink num">{waiting.length}</div>
            <div className="text-sm leading-relaxed text-ink-2">
              {waiting.length === 0 ? "Nothing waiting right now." : quickWaiting === waiting.length ? `${waiting.length === 1 ? "A small change" : "Small changes"} to approve. Each takes a minute to read.` : `${waiting.length === 1 ? "One change" : `${waiting.length} changes`} to approve${quickWaiting ? `, ${quickWaiting} quick` : ""}.`}
            </div>
            {waiting.length > 0 && (
              <Link href={`${base}/fixes`} className="mt-1 text-sm font-semibold text-accent hover:underline">
                Review {waiting.length === 1 ? "it" : "them"} →
              </Link>
            )}
          </Card>
          {traffic ? (
            <Card className="flex flex-col gap-1.5 p-5">
              <div className="text-xs text-ink-3">Visits from Google, last 28 days</div>
              <div className="text-3xl font-bold leading-none tracking-tight text-ink num">{traffic.current.clicks.toLocaleString("en-GB")}</div>
              <div className="text-sm leading-relaxed text-ink-2">
                {pct(traffic.current.clicks, traffic.previous.clicks) ? <span className={`font-semibold ${traffic.current.clicks >= traffic.previous.clicks ? "text-good-text" : "text-critical-text"}`}>{pct(traffic.current.clicks, traffic.previous.clicks)}</span> : "No comparison yet"} on the 28 days before.
                {traffic.current.aiSessions ? ` ${traffic.current.aiSessions} visits came from AI assistants.` : ""}
              </div>
            </Card>
          ) : aiNow ? (
            <Card className="flex flex-col gap-1.5 p-5">
              <div className="text-xs text-ink-3">AI answers naming you</div>
              <div className="text-3xl font-bold leading-none tracking-tight text-ink num">
                {aiNow.mentioned}
                <span className="text-base font-medium text-ink-3"> of {aiNow.answers}</span>
              </div>
              <div className="text-sm leading-relaxed text-ink-2">Monthly check of what assistants say about you. {aiNow.inaccuracies ? `${aiNow.inaccuracies} wrong claim${aiNow.inaccuracies === 1 ? "" : "s"} being fixed.` : "Nothing contradicted the site."}</div>
            </Card>
          ) : (
            <Card className="flex flex-col gap-1.5 p-5">
              <div className="text-xs text-ink-3">Pages checked</div>
              <div className="text-3xl font-bold leading-none tracking-tight text-ink num">{latest?.summary?.inventory?.pages ?? latest?.summary?.pagesTotal ?? "–"}</div>
              <div className="text-sm leading-relaxed text-ink-2">{latest?.summary?.inventory ? `${latest.summary.inventory.broken ? `${latest.summary.inventory.broken} broken` : "All load"}, ${latest.summary.inventory.redirects} redirect, ${latest.summary.inventory.noindex} noindex.` : "Every page is fetched on each audit."}</div>
            </Card>
          )}
        </div>
      </section>

      {/* 2. What changed since last time */}
      {latestChanges && latestChanges.items.length > 0 && (
        <section aria-labelledby="changed" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="changed" className="text-lg font-semibold text-ink">
              Since the last audit{latestChanges.previous ? `, ${fmtDay(latestChanges.previous.finishedAt)}` : ""}
            </h2>
            <Link href={`${base}/changes`} className="text-sm font-medium text-accent hover:underline">
              All changes →
            </Link>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {latestChanges.items.slice(0, 5).map((it, i) => (
              <li key={i} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-4">
                <span className={`inline-flex items-center gap-2 text-xs font-semibold ${it.kind === "fixed" ? "text-good-text" : it.kind === "new" ? "text-warn-text" : "text-ink-2"}`}>
                  <span aria-hidden className={`h-2 w-2 rounded-full ${it.kind === "fixed" ? "bg-good" : it.kind === "new" ? "bg-warn" : "bg-line-2"}`} />
                  {it.kind === "fixed" ? "Fixed" : it.kind === "new" ? "New" : it.kind === "open" ? "Still open" : "Checked"}
                </span>
                <span className="text-ink">
                  {it.title}
                  {it.pagePath ? <span className="font-mono text-xs text-ink-3"> {it.pagePath}</span> : null}
                  {it.detail && it.kind !== "new" ? <span className="text-ink-2"> · {it.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. What to do first */}
      {latest && <FixFirst findings={findings} proposals={proposals} audience={role} />}

      {/* 4. Every area */}
      <section aria-labelledby="areas" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="areas" className="text-lg font-semibold text-ink">
            Every area
          </h2>
          {latest && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter findings by severity">
              {(["all", ...SEVERITY_ORDER] as const).map((s) => (
                <Link key={s} href={s === "all" ? base : `${base}?sev=${s}`} className={`rounded-md px-2 py-0.5 text-xs font-medium ${severity === s ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`} aria-current={severity === s ? "true" : undefined}>
                  {s === "all" ? "All" : `${s} ${counts[s] ? counts[s] : ""}`.trim()}
                </Link>
              ))}
            </div>
          )}
        </div>
        {latest ? (
          <>
            <AreaTable scores={latest.scores} previousScores={previous?.scores} findings={findings} audience={role} />
            <CategorySections
              scores={latest.scores}
              previousScores={previous?.scores}
              findings={findings}
              siteId={site.id}
              baseUrl={site.baseUrl}
              back={base}
              proposals={proposals}
              newFingerprints={newFps}
              severity={severity}
              readOnly={!team}
              audience={role}
              aiSummary={latest.summary?.aiVisibility}
              extras={{
                ...(latest.summary?.inventory ? { seo: <InventoryCard summary={latest.summary.inventory} embedded audience={role} /> } : {}),
                ...(metrics.length > 0 || latest.summary?.perf ? { performance: <PerformanceCard metrics={metrics} unavailable={latest.summary?.perf?.unavailable} embedded /> } : {}),
              }}
            />
          </>
        ) : (
          <Card>
            <EmptyState title="No completed audit yet" body={team ? "Use Audit now (top right) to run the first one; it takes about 5–10 minutes." : "Beqi runs the first audit shortly; the results appear here."} />
          </Card>
        )}
      </section>

      {latest?.agentSummary && (
        <section aria-labelledby="summary" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="summary" className="text-lg font-semibold text-ink">
              {team ? "Claude's summary" : "In short"}
            </h2>
            <span className="text-xs text-ink-3">
              {latest.summary?.pagesReviewed ?? 0} of {latest.summary?.pagesTotal ?? 0} pages read{team ? ` · ${fmtDuration(latest.usage?.durationMs)} · ${fmtCost(latest.usage?.estimatedCostUsd)}` : ""} ·{" "}
              <Link href={`/runs/${latest.id}`} className="text-accent underline">
                full report
              </Link>
            </span>
          </div>
          <Card className="grid gap-5 p-5 lg:grid-cols-[1fr_18rem]">
            <Markdown text={latest.agentSummary} />
            {latest.highlights && latest.highlights.length > 0 && (
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Highlights</div>
                <ul className="space-y-1.5 text-sm text-ink-2">
                  {latest.highlights.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="text-accent">
                        ▸
                      </span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </section>
      )}

      {/* 5. What it is doing for you */}
      <section aria-labelledby="doing" className="space-y-3">
        <h2 id="doing" className="text-lg font-semibold text-ink">
          What it is doing for you
        </h2>
        <TrafficCard summary={stats} fixedPages={fixedPages} siteId={site.id} siteName={site.name} linked={!!(site.gscProperty || site.ga4Property)} googleConnected={!!googleConnection} audience={role} />
        {aiNow && (
          <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
            <span className="text-ink-2">
              <span className="font-semibold text-ink">AI answers check:</span> assistants name you in {aiNow.mentioned} of {aiNow.answers} sampled answers, link to your site in {aiNow.cited}
              {aiNow.inaccuracies ? `, and got ${aiNow.inaccuracies} fact${aiNow.inaccuracies === 1 ? "" : "s"} wrong` : ""}. Checked monthly; a direction, not a score.
            </span>
            <Link href={`${base}/ai`} className="font-medium text-accent hover:underline">
              Every question, month by month →
            </Link>
          </Card>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm text-ink-2">
        <span>
          {client.leadName ? (
            <>
              Your Beqi lead is <strong className="font-semibold text-ink">{client.leadName}</strong>
              {client.leadEmail ? (
                <>
                  {" · "}
                  <a href={`mailto:${client.leadEmail}`} className="text-accent underline">
                    {client.leadEmail}
                  </a>
                </>
              ) : null}
            </>
          ) : (
            "Looked after by Beqi"
          )}
        </span>
        <span className="text-ink-3">
          {site.auditFrequency === "off" ? (team ? "Audits run manually" : "Audits run on request") : `Audits ${FREQUENCY_LABELS[site.auditFrequency].toLowerCase()} · next ${fmtDay(site.nextRunAt)}`}
          {latest && team ? ` · last ${timeAgo(latest.finishedAt)}` : ""}
          {" · "}
          <Link href={`${base}/audits`} className="text-accent underline">
            all audits
          </Link>
        </span>
      </footer>
    </div>
  );
}
