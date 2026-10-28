import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clientDetail } from "@/lib/queries";
import { FREQUENCY_LABELS } from "@/db/schema";
import { runNow } from "@/app/actions";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardHeader, CountPill, Delta, EmptyState, ScoreRing, Sparkline, StatusPill, btnSecondary, btnSm, fmtDay, hostOf, timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Sites` : "Sites" };
}

export default async function ClientSites({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch> }) {
  const { id } = await params;
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections } = data;
  const active = connections.filter((c) => !c.revokedAt);

  return (
    <div className="space-y-6">
      <ClientNotices q={q} />
      <Card>
        <CardHeader title="Sites" count={sites.length} description="Every site in the client's connected Webflow workspaces. Open a site for its findings, fix proposals and audit schedule." />
        {sites.length === 0 ? (
          <EmptyState
            title="No sites yet"
            body={active.length ? "The connected workspace returned no sites. Use “Re-import sites” in Settings after adding one in Webflow." : "Sites are imported automatically when a workspace is connected in Settings."}
            action={
              <Link href={`/clients/${client.id}/settings`} className={btnSecondary}>
                Go to Settings
              </Link>
            }
          />
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
                  <th>Schedule</th>
                  <th>Last audit</th>
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
                      <div className="flex flex-wrap gap-1">
                        <CountPill n={s.openBySeverity.critical} tone="critical" label="critical" />
                        <CountPill n={s.openBySeverity.high} tone="serious" label="high" />
                        <CountPill n={s.openBySeverity.medium} tone="warn" label="medium" />
                        {s.latest && s.openFindings === 0 && <span className="text-xs text-good-text">Clean</span>}
                        {!s.latest && <span className="text-xs text-ink-3">not audited yet</span>}
                      </div>
                    </td>
                    <td>
                      {s.pendingFixes ? (
                        <Link href={`/clients/${client.id}/fixes`} className="text-xs font-medium text-accent hover:underline">
                          {s.pendingFixes} to review
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-3">—</span>
                      )}
                    </td>
                    <td className="text-ink-2">{s.site.auditFrequency === "off" ? "manual" : `${FREQUENCY_LABELS[s.site.auditFrequency]} · ${fmtDay(s.site.nextRunAt)}`}</td>
                    <td className="whitespace-nowrap text-ink-2">
                      {s.running ? (
                        <Link href={`/runs/${s.running}`}>
                          <StatusPill status="running" />
                        </Link>
                      ) : (
                        timeAgo(s.latest?.finishedAt)
                      )}
                    </td>
                    <td className="text-right">
                      <form action={runNow}>
                        <input type="hidden" name="siteId" value={s.site.id} />
                        <SubmitButton className={`${btnSecondary} ${btnSm}`} disabled={!s.site.connectionId || !!s.running} pendingLabel="Starting…">
                          {s.running ? "Running…" : "Audit"}
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
