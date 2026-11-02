import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeClient, requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { getDb } from "@/db";
import type { Severity } from "@/db/schema";
import { FREQUENCY_LABELS } from "@/db/schema";
import { clientDetail, primarySite, siteDetail } from "@/lib/queries";
import { clientProgress, lastDays } from "@/lib/progress";
import { statsSummary } from "@/lib/google/sync";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { CategorySections } from "@/components/category-sections";
import { TopIssues } from "@/components/top-issues";
import { Markdown } from "@/components/markdown";
import { ProposalRow } from "@/components/proposals";
import { PerformanceCard } from "@/components/insights";
import { InventoryCard } from "@/components/inventory-card";
import { TrafficCard } from "@/components/traffic-card";
import { ProgressCard, type TrafficDelta } from "@/components/progress-card";
import { humanAction } from "@/lib/activity";
import { Card, CardHeader, Delta, EmptyState, Notice, ScoreRing, Sparkline, StatTile, StatusPill, btnSecondary, btnSm, fmtCost, fmtDate, fmtDay, fmtDuration, timeAgo, triggerLabel } from "@/components/ui";
import { SCORED_CATEGORIES, SEVERITY_ORDER } from "@/audit/score";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "Client" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Overview` : "Client" };
}

// The client's home: one site, so this is the site report itself. Score and
// progress first, then what to fix, every area with its findings, the
// summary, search and traffic, the fixes waiting, and the history.
export default async function ClientOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch & { sev?: string }> }) {
  const { id } = await params;
  const team = isTeam(await requireClientAccess(id, `/clients/${id}`));
  const role = team ? "team" : "client";
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections, pendingFixes, activity } = data;
  const site = primarySite(sites.map((s) => s.site));
  const detail = site ? await siteDetail(site.id) : null;
  const active = connections.filter((c) => !c.revokedAt);
  const base = `/clients/${client.id}`;
  const visibleActivity = team ? activity : activity.filter((a) => a.action.startsWith("fix.") || a.action.startsWith("run."));
  const waiting = team ? pendingFixes : pendingFixes.filter((p) => p.status === "proposed");

  if (!site || !detail) {
    return (
      <div className="space-y-6">
        <ClientNotices q={q} />
        <Card>
          <EmptyState
            title={team ? "No site yet" : "Your site is being set up"}
            body={team ? (active.length ? "The connected workspace returned no site. Use “Re-import” in Settings after adding one in Webflow, or choose the site when the workspace has several." : "Connect the client's Webflow workspace in Settings; the site is imported from it.") : "Beqi is connecting your Webflow site. Your first audit appears here once it has run."}
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
  const window = lastDays(30);
  const progress = latest ? await clientProgress(db, client.id, window.since, window.until) : null;
  let traffic: TrafficDelta | null = null;
  if (site.gscProperty || site.ga4Property) {
    const x = await statsSummary(db, site.id);
    if (x.hasData) traffic = { clicks: x.current.clicks, clicksBefore: x.previous.clicks, sessions: x.current.sessions, sessionsBefore: x.previous.sessions, aiSessions: x.current.aiSessions, aiSessionsBefore: x.previous.aiSessions };
  }
  const running = runs.find((r) => r.status === "running" || r.status === "queued") ?? null;
  const history = runs.filter((r) => r.status === "complete").map((r) => r.scoreOverall).reverse().slice(-12);
  const severity = (SEVERITY_ORDER as string[]).includes(q.sev ?? "") ? (q.sev as Severity) : "all";
  const newFps = new Set(findings.filter((f) => stateByFp.get(f.fingerprint)?.firstSeenRunId === latest?.id).map((f) => f.fingerprint));
  const openProposals = proposals.filter((p) => (team ? p.status === "proposed" || p.status === "client_approved" || p.status === "approved" || p.status === "applying" || p.status === "failed" : p.status === "proposed"));
  const doneProposals = proposals.filter((p) => p.status === "applied" || p.status === "resolved" || p.status === "rejected" || (!team && (p.status === "client_approved" || p.status === "approved" || p.status === "applying"))).slice(0, 10);
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;

  return (
    <div className="space-y-6">
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
      {team && connection && !latest && !running && (
        <Notice tone="accent">
          <strong>Ready for its first audit.</strong> Claude reviews up to {site.maxPages} pages through Webflow and the live site; expect 5–10 minutes. Nothing is changed on the site during an audit.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <Card className="flex items-center gap-5 px-6 py-5">
          <ScoreRing score={latest?.scoreOverall} size="xl" />
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-ink-3">Overall score</div>
            <div>
              <Delta now={latest?.scoreOverall} before={previous?.scoreOverall} /> <span className="text-xs text-ink-3">vs previous audit</span>
            </div>
            <div className="text-xs text-ink-3">
              Last audit {latest ? timeAgo(latest.finishedAt) : "—"}
              {running && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/runs/${running.id}`} className="text-accent hover:underline">
                    <StatusPill status="running" /> one running
                  </Link>
                </>
              )}
            </div>
            <div className="text-xs text-ink-3">Next {site.auditFrequency === "off" ? (team ? "manual only" : "on request") : `${FREQUENCY_LABELS[site.auditFrequency].toLowerCase()} · ${fmtDay(site.nextRunAt)}`}</div>
            {history.length >= 2 && (
              <div className="pt-1">
                <Sparkline values={history} width={140} height={32} />
              </div>
            )}
          </div>
        </Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Open findings" value={<span className="num">{findings.length}</span>} hint={latest ? `${counts.critical} critical · ${counts.high} high` : "no audit yet"} />
          <StatTile label={team ? "Fixes to review" : "Waiting for your approval"} value={<span className="num">{waiting.length}</span>} hint={waiting.length ? (team ? "waiting for a decision" : "recommended by Beqi") : "nothing waiting"}>
            {waiting.length > 0 && (
              <Link href={`${base}/fixes`} className={`${btnSecondary} ${btnSm}`}>
                Review
              </Link>
            )}
          </StatTile>
          <StatTile label="Audits" value={<span className="num">{runs.filter((r) => r.status === "complete").length}</span>} hint={latest ? `${latest.summary?.newFindings ?? 0} new · ${latest.summary?.resolvedFindings ?? 0} resolved last time` : "none yet"} />
        </div>
      </div>

      {progress && <ProgressCard progress={progress} clientId={client.id} label="Last 30 days · scores then and now, what was fixed, what is waiting" audience={role} traffic={traffic} />}

      <section aria-labelledby="areas" className="space-y-3">
        <CardHeader
          title="Findings"
          count={findings.length}
          description={latest ? `From the latest audit on ${fmtDate(latest.finishedAt)} · what to fix first, then every area with its score` : undefined}
          actions={
            latest && (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by severity">
                {(["all", ...SEVERITY_ORDER] as const).map((s) => (
                  <Link
                    key={s}
                    href={s === "all" ? base : `${base}?sev=${s}`}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${severity === s ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
                    aria-current={severity === s ? "true" : undefined}
                  >
                    {s === "all" ? "All" : `${s} ${counts[s] ? counts[s] : ""}`.trim()}
                  </Link>
                ))}
              </div>
            )
          }
        />
        {latest ? (
          <>
            <TopIssues findings={findings} proposals={proposals} baseUrl={site.baseUrl} audience={role} />
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
        <Card>
          <CardHeader
            title={team ? "Claude's summary" : "Summary"}
            description={`From the audit on ${fmtDate(latest.finishedAt)} · ${latest.summary?.pagesReviewed ?? 0} of ${latest.summary?.pagesTotal ?? 0} pages reviewed${team ? ` · ${fmtDuration(latest.usage?.durationMs)} · ${fmtCost(latest.usage?.estimatedCostUsd)}` : ""}`}
            actions={
              <Link href={`/runs/${latest.id}`} className="text-xs font-medium text-accent hover:underline">
                Full report
              </Link>
            }
          />
          <div className="grid gap-5 p-5 lg:grid-cols-[1fr_18rem]">
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
          </div>
        </Card>
      )}

      <TrafficCard summary={stats} fixedPages={fixedPages} siteId={site.id} siteName={site.name} linked={!!(site.gscProperty || site.ga4Property)} googleConnected={!!googleConnection} audience={role} />

      <Card id="fixes">
        <CardHeader title={team ? "Proposed fixes" : "Recommended fixes"} count={openProposals.length} description={team ? "Nothing is written to Webflow until you approve it. Applied changes go live on the site's next publish." : "Nothing is changed until you approve it. Small, safe changes are applied right away; larger ones are applied by Beqi after your approval."} />
        {openProposals.length === 0 ? (
          <EmptyState title="No fixes waiting" body={latest ? (team ? "Claude found nothing it can safely fix automatically, or everything has been reviewed." : "Nothing is waiting for your approval right now.") : team ? "Run an audit to get fix proposals." : "Recommendations appear after the first audit."} />
        ) : (
          <ul className="divide-y divide-line">
            {openProposals.map((p) => (
              <ProposalRow key={p.id} proposal={p} back={`${base}#fixes`} role={role} />
            ))}
          </ul>
        )}
        {doneProposals.length > 0 && (
          <details className="border-t border-line">
            <summary className="px-5 py-2.5 text-xs font-medium text-ink-3 hover:text-ink">Recently applied or rejected ({doneProposals.length})</summary>
            <ul className="divide-y divide-line border-t border-line">
              {doneProposals.map((p) => (
                <ProposalRow key={p.id} proposal={p} back={`${base}#fixes`} role={role} />
              ))}
            </ul>
          </details>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Audit history"
            count={runs.length}
            actions={
              <Link href={`${base}/audits`} className="text-xs font-medium text-accent hover:underline">
                All audits
              </Link>
            }
          />
          {runs.length === 0 ? (
            <EmptyState title="No audits yet" />
          ) : (
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Findings</th>
                  {team && <th>Cost</th>}
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/runs/${r.id}`} className="text-ink hover:underline">
                        {fmtDate(r.createdAt)}
                      </Link>
                    </td>
                    <td className="text-ink-2">{triggerLabel(r.trigger)}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="num">{r.scoreOverall ?? "—"}</td>
                    <td className="num text-ink-2">{r.summary ? Object.values(r.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : "—"}</td>
                    {team && <td className="num text-ink-2">{fmtCost(r.usage?.estimatedCostUsd)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {team ? (
          <Card>
            <CardHeader title="Recent activity" />
            {visibleActivity.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="divide-y divide-line">
                {visibleActivity.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-ink">{humanAction(a.action)}</span>
                      <span className="text-ink-3"> · {a.actor}</span>
                    </div>
                    <time className="shrink-0 text-xs text-ink-3" dateTime={a.createdAt}>
                      {timeAgo(a.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card>
            <CardHeader title="How this works" />
            <div className="space-y-2 p-5 text-sm text-ink-2">
              <p>
                Beqi audits your site {site.auditFrequency === "off" ? "on request" : FREQUENCY_LABELS[site.auditFrequency].toLowerCase()}
                {site.auditOnPublish ? " and after each publish" : ""}, reviewing up to {site.maxPages} pages across {SCORED_CATEGORIES.length} areas. Nothing on the site is changed by an audit.
              </p>
              <p>Fixes are only applied after you approve them. Small, safe changes go in straight away; anything larger is applied by Beqi, and the next audit confirms it.</p>
              {client.leadName && (
                <p>
                  Questions? Your Beqi lead is <span className="font-medium text-ink">{client.leadName}</span>
                  {client.leadEmail ? (
                    <>
                      {" "}
                      (
                      <a href={`mailto:${client.leadEmail}`} className="text-accent hover:underline">
                        {client.leadEmail}
                      </a>
                      )
                    </>
                  ) : null}
                  .
                </p>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
