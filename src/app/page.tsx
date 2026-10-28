import Link from "next/link";
import { dashboardData, pendingFixesAcrossPortfolio, recentActivity, recentRuns } from "@/lib/queries";
import { ProposalRow } from "@/components/proposals";
import { Card, CardHeader, CountPill, Delta, EmptyState, Notice, PageHeader, ScoreRing, Sparkline, StatTile, StatusPill, btnPrimary, btnSecondary, fmtDay, hostOf, timeAgo } from "@/components/ui";
import { runNow } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [clients, pending, activity, runs] = await Promise.all([dashboardData(), pendingFixesAcrossPortfolio(), recentActivity(12), recentRuns(40)]);
  const allSites = clients.flatMap((c) => c.sites);
  const scored = allSites.filter((s) => s.latest?.scoreOverall != null);
  const avg = scored.length ? Math.round(scored.reduce((a, s) => a + (s.latest!.scoreOverall ?? 0), 0) / scored.length) : null;
  const prevAvg = scored.filter((s) => s.previous?.scoreOverall != null).length
    ? Math.round(scored.filter((s) => s.previous?.scoreOverall != null).reduce((a, s) => a + (s.previous!.scoreOverall ?? 0), 0) / scored.filter((s) => s.previous?.scoreOverall != null).length)
    : null;
  const critical = allSites.reduce((a, s) => a + s.openBySeverity.critical, 0);
  const high = allSites.reduce((a, s) => a + s.openBySeverity.high, 0);
  const weekAgo = sinceDays(7);
  const runsThisWeek = runs.filter((r) => new Date(r.createdAt).getTime() > weekAgo && r.status === "complete").length;
  const needsAttention = allSites
    .filter((s) => s.latest && (s.openBySeverity.critical > 0 || (s.latest.scoreOverall ?? 100) < 70))
    .sort((a, b) => (a.latest?.scoreOverall ?? 0) - (b.latest?.scoreOverall ?? 0))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portfolio"
        description={`${clients.length} client${clients.length === 1 ? "" : "s"} · ${allSites.length} site${allSites.length === 1 ? "" : "s"} under audit`}
        actions={
          <Link href="/clients/new" className={btnPrimary}>
            Add client
          </Link>
        }
      />

      {error && <Notice tone="critical">{error}</Notice>}

      {allSites.length === 0 ? (
        <Card>
          <EmptyState
            title="No sites yet"
            body="Add a client, then connect their Webflow workspace. Every site in the workspace is imported and scheduled for a weekly audit."
            action={
              <Link href="/clients/new" className={btnPrimary}>
                Add your first client
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
            <Card className="flex items-center gap-5 px-6 py-5">
              <ScoreRing score={avg} size="xl" label={avg == null ? "No audits yet" : `Portfolio average score ${avg}`} />
              <div>
                <div className="text-xs font-medium text-ink-3">Average score</div>
                <div className="mt-1 text-sm text-ink-2">
                  Across {scored.length} audited site{scored.length === 1 ? "" : "s"}
                </div>
                <div className="mt-2">
                  <Delta now={avg} before={prevAvg} /> <span className="text-xs text-ink-3">vs previous audits</span>
                </div>
              </div>
            </Card>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Critical issues open" value={<span className={critical ? "text-critical" : ""}>{critical}</span>} hint={`${high} high`} />
              <StatTile label="Fixes awaiting review" value={pending.length} hint={pending.length ? "Approve to let Claude apply them" : "Nothing waiting"} />
              <StatTile label="Audits this week" value={runsThisWeek} hint={`${runs.filter((r) => r.status === "running" || r.status === "queued").length} running now`} />
            </div>
          </div>

          {needsAttention.length > 0 && (
            <Card>
              <CardHeader title="Needs attention" description="Critical findings or a score under 70 in the latest audit" />
              <ul className="divide-y divide-line">
                {needsAttention.map((s) => (
                  <li key={s.site.id} className="flex items-center gap-4 px-5 py-3">
                    <ScoreRing score={s.latest?.scoreOverall} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/sites/${s.site.id}`} className="text-sm font-medium text-ink hover:underline">
                        {s.site.name}
                      </Link>
                      <div className="text-xs text-ink-3">{hostOf(s.site.baseUrl)}</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <CountPill n={s.openBySeverity.critical} tone="critical" label="critical" />
                      <CountPill n={s.openBySeverity.high} tone="serious" label="high" />
                      <CountPill n={s.pendingFixes} tone="warn" label="fixes" />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {clients.map(({ client, sites, connected }) => (
            <Card key={client.id}>
              <CardHeader
                title={client.name}
                count={sites.length}
                description={connected ? undefined : "Webflow workspace not connected"}
                actions={
                  <div className="flex gap-2">
                    {!connected && (
                      // A plain anchor: Next's <Link> would prefetch this route and start an OAuth flow.
                      <a href={`/api/webflow/authorize?client=${client.id}`} className={`${btnSecondary} !py-1 !text-xs`}>
                        Connect Webflow
                      </a>
                    )}
                    <Link href={`/clients/${client.id}`} className={`${btnSecondary} !py-1 !text-xs`}>
                      Open
                    </Link>
                  </div>
                }
              />
              {sites.length === 0 ? (
                <EmptyState title="No sites imported yet" body={connected ? "The workspace is connected but returned no sites." : "Connect the client's Webflow workspace to import its sites."} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>Site</th>
                        <th>Score</th>
                        <th>Trend</th>
                        <th>Open issues</th>
                        <th>Fixes</th>
                        <th>Last audit</th>
                        <th>Next</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {sites.map((s) => (
                        <tr key={s.site.id}>
                          <td>
                            <Link href={`/sites/${s.site.id}`} className="font-medium text-ink hover:underline">
                              {s.site.name}
                            </Link>
                            <div className="text-xs text-ink-3">{hostOf(s.site.baseUrl)}</div>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <ScoreRing score={s.latest?.scoreOverall} size="sm" />
                              <Delta now={s.latest?.scoreOverall} before={s.previous?.scoreOverall} />
                            </div>
                          </td>
                          <td>
                            <Sparkline values={s.history} />
                          </td>
                          <td>
                            {s.latest ? (
                              <div className="flex flex-wrap gap-1">
                                <CountPill n={s.openBySeverity.critical} tone="critical" label="critical" />
                                <CountPill n={s.openBySeverity.high} tone="serious" label="high" />
                                <CountPill n={s.openBySeverity.medium} tone="warn" label="medium" />
                                {s.openFindings === 0 && <span className="text-xs text-good">Clean</span>}
                              </div>
                            ) : (
                              <span className="text-xs text-ink-3">not audited</span>
                            )}
                          </td>
                          <td>
                            {s.pendingFixes ? (
                              <Link href={`/sites/${s.site.id}#fixes`} className="text-xs font-medium text-accent hover:underline">
                                {s.pendingFixes} to review
                              </Link>
                            ) : (
                              <span className="text-xs text-ink-3">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap text-ink-2">
                            {s.running ? <StatusPill status="running" /> : s.latest ? timeAgo(s.latest.finishedAt) : "—"}
                          </td>
                          <td className="whitespace-nowrap text-ink-2">{s.site.auditFrequency === "off" ? "manual" : fmtDay(s.site.nextRunAt)}</td>
                          <td className="text-right">
                            <form action={runNow}>
                              <input type="hidden" name="siteId" value={s.site.id} />
                              <button className={`${btnSecondary} !py-1 !text-xs`} disabled={!s.site.connectionId || s.running}>
                                Audit now
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Fixes awaiting review"
                count={pending.length}
                actions={
                  <Link href="/fixes" className="text-xs font-medium text-accent hover:underline">
                    All fixes
                  </Link>
                }
              />
              {pending.length === 0 ? (
                <EmptyState title="Nothing to review" body="Claude proposes fixes during audits; they appear here until you approve or reject them." />
              ) : (
                <ul className="divide-y divide-line">
                  {pending.slice(0, 4).map((p) => (
                    <ProposalRow key={p.id} proposal={p} site={p.site} back="/" compact />
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Recent activity" />
              {activity.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ul className="divide-y divide-line">
                  {activity.map((a) => (
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
        </>
      )}
    </div>
  );
}

// Kept outside the component so the render stays pure for the lint rule; the
// page is force-dynamic, so a fresh timestamp per request is what we want.
function sinceDays(days: number): number {
  return Date.now() - days * 86400_000;
}

function humanAction(action: string): string {
  const map: Record<string, string> = {
    "client.created": "Client added",
    "client.updated": "Client updated",
    "webflow.connected": "Webflow workspace connected",
    "webflow.connect_failed": "Webflow connection failed",
    "webflow.sites_imported": "Sites imported from Webflow",
    "webflow.import_failed": "Site import from Webflow failed",
    "webflow.disconnected": "Webflow workspace disconnected",
    "run.started": "Audit started",
    "site.settings_updated": "Site settings changed",
    "ignore_rule.created": "Ignore rule added",
    "finding.state_changed": "Finding status changed",
    "fix.approved": "Fix approved",
    "fix.rejected": "Fix rejected",
    "fix.apply_started": "Fix application started",
    "fix.applied": "Fix applied",
    "fix.skipped": "Fix skipped (value changed since audit)",
    "fix.failed": "Fix failed",
  };
  return map[action] ?? action;
}
