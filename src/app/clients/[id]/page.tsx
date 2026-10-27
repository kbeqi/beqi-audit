import Link from "next/link";
import { notFound } from "next/navigation";
import { clientDetail } from "@/lib/queries";
import { disconnectWorkspace, runNow, updateClient } from "@/app/actions";
import { Card, CardHeader, CountPill, Crumbs, Delta, EmptyState, Notice, PageHeader, ScoreRing, Sparkline, StatusPill, btnDanger, btnPrimary, btnSecondary, btnSm, fmtDay, hostOf, inputCls, labelCls, timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { id } = await params;
  const { connected, error } = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections } = data;
  const active = connections.filter((c) => !c.revokedAt);

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/clients", label: "Clients" }, { label: client.name }]} />
      <PageHeader
        title={client.name}
        description={client.notes ? <span className="whitespace-pre-line">{client.notes}</span> : undefined}
        actions={
          // A plain anchor: Next's <Link> would prefetch this route and start an OAuth flow.
          <a href={`/api/webflow/authorize?client=${client.id}`} className={active.length ? btnSecondary : btnPrimary}>
            {active.length ? "Connect another workspace" : "Connect Webflow"}
          </a>
        }
      />

      {connected && (
        <Notice tone="good">
          Connected. {connected} site{connected === "1" ? "" : "s"} imported and scheduled for a weekly audit. Run one now from a site row to see results today.
        </Notice>
      )}
      {error && <Notice tone="critical">{decodeURIComponent(error)}</Notice>}

      <Card>
        <CardHeader title="Sites" count={sites.length} />
        {sites.length === 0 ? (
          <EmptyState title="No sites yet" body="Sites are imported automatically when a workspace is connected." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Score</th>
                  <th>Trend</th>
                  <th>Open issues</th>
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
                        {s.latest && s.openFindings === 0 && <span className="text-xs text-good">Clean</span>}
                      </div>
                    </td>
                    <td className="text-ink-2">
                      {s.site.auditFrequency === "off" ? "manual" : `${s.site.auditFrequency} · ${fmtDay(s.site.nextRunAt)}`}
                    </td>
                    <td className="whitespace-nowrap text-ink-2">{s.running ? <StatusPill status="running" /> : timeAgo(s.latest?.finishedAt)}</td>
                    <td className="text-right">
                      <form action={runNow}>
                        <input type="hidden" name="siteId" value={s.site.id} />
                        <button className={`${btnSecondary} ${btnSm}`} disabled={!s.site.connectionId || s.running}>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Webflow connections" description="Authorized through Webflow's MCP server, once per workspace" />
          {connections.length === 0 ? (
            <EmptyState title="Not connected" body="A Beqi team member with access to the client's workspace authorizes it once. No Webflow app install is needed." />
          ) : (
            <ul className="divide-y divide-line">
              {connections.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{c.label ?? c.workspaceName ?? "Workspace"}</div>
                    <div className="text-xs text-ink-3">
                      {c.authorizedSiteIds.length} site{c.authorizedSiteIds.length === 1 ? "" : "s"} · by {c.authorizedBy ?? "—"} · {fmtDay(c.createdAt)}
                      {c.revokedAt ? ` · disconnected ${fmtDay(c.revokedAt)}` : c.expiresAt ? ` · token renews automatically` : ""}
                    </div>
                  </div>
                  {!c.revokedAt && (
                    <form action={disconnectWorkspace}>
                      <input type="hidden" name="connectionId" value={c.id} />
                      <input type="hidden" name="clientId" value={client.id} />
                      <button className={`${btnDanger} ${btnSm}`}>Disconnect</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Client details" />
          <form action={updateClient} className="space-y-3 p-5">
            <input type="hidden" name="clientId" value={client.id} />
            <div>
              <label htmlFor="name" className={labelCls}>
                Name
              </label>
              <input id="name" name="name" defaultValue={client.name} required className={inputCls} />
            </div>
            <div>
              <label htmlFor="notes" className={labelCls}>
                Notes
              </label>
              <textarea id="notes" name="notes" rows={3} defaultValue={client.notes ?? ""} className={inputCls} />
            </div>
            <button className={btnSecondary}>Save</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
