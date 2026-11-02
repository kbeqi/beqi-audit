import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeClient, requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { clientDetail } from "@/lib/queries";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { Card, CardHeader, EmptyState, StatusPill, fmtCost, fmtDate, fmtDuration, triggerLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "Audits" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Audits` : "Audits" };
}

export default async function ClientAudits({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch & { site?: string }> }) {
  const { id } = await params;
  const team = isTeam(await requireClientAccess(id, `/clients/${id}/audits`));
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, runs } = data;
  const filtered = q.site ? runs.filter((r) => r.siteId === q.site) : runs;
  const base = `/clients/${client.id}/audits`;

  return (
    <div className="space-y-6">
      <h1 className="sr-only">{client.name} · Audits</h1>
      <ClientNotices q={q} />
      <Card>
        <CardHeader
          title="Audits"
          count={filtered.length}
          description={team ? "Every audit of this client's sites, newest first. Scheduled audits run automatically; use Audit now for an extra one." : "Every audit of your sites, newest first. Beqi runs them on a schedule and after each publish."}
          actions={
            sites.length > 1 ? (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by site">
                <Link href={base} className={`rounded-md px-2 py-0.5 text-xs font-medium ${!q.site ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`} aria-current={!q.site ? "true" : undefined}>
                  All sites
                </Link>
                {sites.map((s) => (
                  <Link key={s.site.id} href={`${base}?site=${s.site.id}`} className={`rounded-md px-2 py-0.5 text-xs font-medium ${q.site === s.site.id ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`} aria-current={q.site === s.site.id ? "true" : undefined}>
                    {s.site.name}
                  </Link>
                ))}
              </div>
            ) : undefined
          }
        />
        {filtered.length === 0 ? (
          <EmptyState title="No audits yet" body={team ? "Use Audit now (top right) to run the first one." : "Your first audit will appear here once Beqi runs it."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>When</th>
                  {sites.length > 1 && <th>Site</th>}
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Pages</th>
                  <th>Findings</th>
                  {team && <th>Duration</th>}
                  {team && <th>Cost</th>}
                  {team && <th>Shared</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const s = sites.find((x) => x.site.id === r.siteId);
                  const findings = r.summary ? Object.values(r.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : null;
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/runs/${r.id}`} className="font-medium text-ink hover:underline">
                          {fmtDate(r.createdAt)}
                        </Link>
                      </td>
                      {sites.length > 1 && <td className="text-ink-2">{s?.site.name ?? "—"}</td>}
                      <td className="text-ink-2">{triggerLabel(r.trigger)}</td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                      <td className="num">{r.scoreOverall ?? "—"}</td>
                      <td className="num text-ink-2">{r.summary ? `${r.summary.pagesReviewed}/${r.summary.pagesTotal}` : "—"}</td>
                      <td className="num text-ink-2">{findings ?? "—"}</td>
                      {team && <td className="num text-ink-2">{fmtDuration(r.usage?.durationMs)}</td>}
                      {team && <td className="num text-ink-2">{fmtCost(r.usage?.estimatedCostUsd)}</td>}
                      {team && (
                        <td>
                          {r.shareToken ? (
                            <Link href={`/share/${r.shareToken}`} target="_blank" className="text-xs text-accent hover:underline">
                              link
                            </Link>
                          ) : (
                            <span className="text-xs text-ink-3">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
