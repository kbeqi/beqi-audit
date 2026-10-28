import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clientDetail } from "@/lib/queries";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { Markdown } from "@/components/markdown";
import { Card, CardHeader, CountPill, Delta, EmptyState, Notice, ScoreRing, StatTile, btnSecondary, btnSm, fmtDate, scoreTone, timeAgo } from "@/components/ui";
import { CATEGORY_LABELS, SCORED_CATEGORIES } from "@/audit/score";
import { humanAction } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Overview` : "Client" };
}

export default async function ClientOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch> }) {
  const { id } = await params;
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections, latest, previousOfLatest, latestFindings, pendingFixes, activity, runs } = data;
  const active = connections.filter((c) => !c.revokedAt);
  const connectedSites = sites.filter((s) => s.site.connectionId);
  const latestSite = latest ? sites.find((s) => s.site.id === latest.siteId) : undefined;
  const critical = sites.reduce((a, s) => a + s.openBySeverity.critical, 0);
  const high = sites.reduce((a, s) => a + s.openBySeverity.high, 0);
  const openTotal = sites.reduce((a, s) => a + s.openFindings, 0);
  const base = `/clients/${client.id}`;

  return (
    <div className="space-y-6">
      <ClientNotices q={q} />
      {active.length === 0 && (
        <Notice tone="accent">
          <strong>Next step:</strong>{" "}
          <Link href={`${base}/settings`} className="font-medium underline">
            connect the client&apos;s Webflow workspace
          </Link>
          . You authorize it once with your own Webflow login; every site in the workspace is imported automatically.
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open findings" value={<span className="num">{openTotal}</span>} hint={latest ? `${critical} critical · ${high} high` : "no audit yet"} />
        <StatTile label="Fixes to review" value={<span className="num">{pendingFixes.length}</span>} hint={pendingFixes.length ? "waiting for a decision" : "nothing waiting"}>
          {pendingFixes.length > 0 && (
            <Link href={`${base}/fixes`} className={`${btnSecondary} ${btnSm}`}>
              Review
            </Link>
          )}
        </StatTile>
        <StatTile label="Audits" value={<span className="num">{runs.length}</span>} hint={latest ? `latest ${timeAgo(latest.finishedAt)}` : "none yet"} />
        <StatTile label="Sites" value={<span className="num">{sites.length}</span>} hint={`${connectedSites.length} connected`} />
      </div>

      {latest && latestSite ? (
        <Card>
          <CardHeader
            title="Latest audit"
            description={`${latestSite.site.name} · ${fmtDate(latest.finishedAt)} · ${latest.summary?.pagesReviewed ?? 0} of ${latest.summary?.pagesTotal ?? 0} pages reviewed`}
            actions={
              <div className="flex gap-2">
                <Link href={`/runs/${latest.id}`} className={`${btnSecondary} ${btnSm}`}>
                  Full report
                </Link>
                {latest.shareToken && (
                  <Link href={`/share/${latest.shareToken}`} target="_blank" className={`${btnSecondary} ${btnSm}`}>
                    Shared link
                  </Link>
                )}
              </div>
            }
          />
          <div className="grid gap-6 p-5 lg:grid-cols-[auto_1fr]">
            <div className="flex items-center gap-5">
              <ScoreRing score={latest.scoreOverall} size="xl" />
              <div className="space-y-1 text-sm">
                <div className="font-medium text-ink">Overall score</div>
                <div>
                  <Delta now={latest.scoreOverall} before={previousOfLatest?.scoreOverall} /> <span className="text-xs text-ink-3">vs previous audit</span>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <CountPill n={latestSite.openBySeverity.critical} tone="critical" label="critical" />
                  <CountPill n={latestSite.openBySeverity.high} tone="serious" label="high" />
                  <CountPill n={latestSite.openBySeverity.medium} tone="warn" label="medium" />
                  <CountPill n={latestSite.openBySeverity.low} tone="accent" label="low" />
                  {latestFindings.length === 0 && <span className="text-xs text-good-text">No open findings</span>}
                </div>
                <Link href={`/sites/${latestSite.site.id}`} className="inline-block text-xs font-medium text-accent hover:underline">
                  Open findings for {latestSite.site.name} →
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {SCORED_CATEGORIES.map((cat) => {
                const score = latest.scores?.[cat];
                const tone = scoreTone(score);
                return (
                  <div key={cat} className="rounded-lg border border-line px-3 py-2">
                    <div className="truncate text-[11px] font-medium text-ink-3">{CATEGORY_LABELS[cat]}</div>
                    <div className="mt-0.5 flex items-end justify-between">
                      <div className={`text-xl font-semibold leading-none ${tone === "critical" ? "text-critical-text" : "text-ink"}`}>{score ?? "–"}</div>
                      <Delta now={score} before={previousOfLatest?.scores?.[cat]} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {(latest.summary?.aiVisibility?.answers || latest.summary?.perf) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-2.5 text-xs text-ink-3">
              {latest.summary?.perf && latest.summary.perf.pages > 0 && (
                <span>
                  <span className="font-medium text-ink-2">Core Web Vitals:</span> {latest.summary.perf.passing} of {latest.summary.perf.pages} key pages pass
                </span>
              )}
              {latest.summary?.aiVisibility && latest.summary.aiVisibility.answers > 0 && (
                <span>
                  <span className="font-medium text-ink-2">AI answers (sample):</span> mentioned in {latest.summary.aiVisibility.mentioned} of {latest.summary.aiVisibility.answers}, site cited in {latest.summary.aiVisibility.cited}
                  {latest.summary.aiVisibility.inaccuracies ? `, ${latest.summary.aiVisibility.inaccuracies} inaccurate claim${latest.summary.aiVisibility.inaccuracies === 1 ? "" : "s"}` : ""}
                </span>
              )}
              {latest.trigger === "publish" && latest.summary?.regressions && (
                <span>
                  <span className="font-medium text-ink-2">After publish:</span> {latest.summary.regressions.newCriticalHigh ? `${latest.summary.regressions.newCriticalHigh} new critical/high` : "no new critical/high findings"}
                </span>
              )}
            </div>
          )}
          {(latest.highlights?.length || latest.agentSummary) && (
            <div className="grid gap-5 border-t border-line p-5 lg:grid-cols-[1fr_18rem]">
              {latest.agentSummary ? <Markdown text={latest.agentSummary.split("\n\n").slice(0, 2).join("\n\n")} /> : <div />}
              {latest.highlights && latest.highlights.length > 0 && (
                <ul className="space-y-1.5 rounded-lg bg-surface-2 p-4 text-sm text-ink-2">
                  {latest.highlights.slice(0, 5).map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="text-accent">
                        ▸
                      </span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState title="No completed audit yet" body={connectedSites.length ? "Use Audit now (top right) to run the first one; it takes about 5–10 minutes per site." : "Connect the client's Webflow workspace in Settings, then run the first audit."} />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Previous audits"
            count={Math.max(0, runs.length - (latest ? 1 : 0))}
            actions={
              <Link href={`${base}/audits`} className="text-xs font-medium text-accent hover:underline">
                All audits
              </Link>
            }
          />
          {runs.filter((r) => r.id !== latest?.id).length === 0 ? (
            <EmptyState title="No earlier audits" />
          ) : (
            <ul className="divide-y divide-line">
              {runs
                .filter((r) => r.id !== latest?.id)
                .slice(0, 6)
                .map((r) => {
                  const s = sites.find((x) => x.site.id === r.siteId);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <div className="min-w-0">
                        <Link href={`/runs/${r.id}`} className="font-medium text-ink hover:underline">
                          {fmtDate(r.createdAt)}
                        </Link>
                        <div className="text-xs text-ink-3">
                          {sites.length > 1 ? `${s?.site.name ?? "—"} · ` : ""}
                          {r.status === "complete" ? `${r.summary ? Object.values(r.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : 0} findings` : r.status}
                        </div>
                      </div>
                      <ScoreRing score={r.scoreOverall} size="sm" />
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-line">
              {activity.slice(0, 8).map((a) => (
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
      </div>
    </div>
  );
}
