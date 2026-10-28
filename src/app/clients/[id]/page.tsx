import Link from "next/link";
import { notFound } from "next/navigation";
import { clientDetail } from "@/lib/queries";
import { deleteClient, disconnectWorkspace, reimportSites, runNow, updateClient } from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Card, CardHeader, CountPill, Crumbs, Delta, EmptyState, Notice, PageHeader, ScoreRing, Sparkline, StatusPill, btnDanger, btnPrimary, btnSecondary, btnSm, fmtDay, hostOf, inputCls, labelCls, timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";

type Search = { connected?: string; imported?: string; saved?: string; error?: string };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const { connected, imported, saved, error } = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections } = data;
  const active = connections.filter((c) => !c.revokedAt);
  const firstSite = sites[0];

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
          Connected and {connected} site{connected === "1" ? "" : "s"} imported, each scheduled for a weekly audit.{" "}
          {firstSite && (
            <>
              <Link href={`/sites/${firstSite.site.id}`} className="font-medium underline">
                Open {firstSite.site.name}
              </Link>{" "}
              and run the first audit now.
            </>
          )}
        </Notice>
      )}
      {imported && <Notice tone="good">Site list refreshed from Webflow.</Notice>}
      {saved && <Notice tone="good">Client details saved.</Notice>}
      {error && <Notice tone="critical">{decodeURIComponent(error)}</Notice>}

      {active.length === 0 && (
        <Notice tone="accent">
          <strong>Next step:</strong> connect the client&apos;s Webflow workspace. You authorize it once with your own Webflow login; every site in the workspace is imported automatically.
        </Notice>
      )}

      <Card>
        <CardHeader title="Sites" count={sites.length} />
        {sites.length === 0 ? (
          <EmptyState title="No sites yet" body={active.length ? "The connected workspace returned no sites. Use “Re-import sites” below after adding one in Webflow." : "Sites are imported automatically when a workspace is connected."} />
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
                        {!s.latest && <span className="text-xs text-ink-3">not audited yet</span>}
                      </div>
                    </td>
                    <td className="text-ink-2">
                      {s.site.auditFrequency === "off" ? "manual" : `${s.site.auditFrequency} · ${fmtDay(s.site.nextRunAt)}`}
                    </td>
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
                        <button className={`${s.latest ? btnSecondary : btnPrimary} ${btnSm}`} disabled={!s.site.connectionId || !!s.running}>
                          {s.running ? "Running…" : s.latest ? "Audit now" : "Run first audit"}
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
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{c.label ?? c.workspaceName ?? "Workspace"}</div>
                    <div className="text-xs text-ink-3">
                      {c.authorizedSiteIds.length} site{c.authorizedSiteIds.length === 1 ? "" : "s"} · by {c.authorizedBy ?? "—"} · {fmtDay(c.createdAt)}
                      {c.revokedAt ? ` · disconnected ${fmtDay(c.revokedAt)}` : c.expiresAt ? ` · token renews automatically` : ""}
                    </div>
                  </div>
                  {!c.revokedAt && (
                    <div className="flex shrink-0 gap-1.5">
                      <form action={reimportSites}>
                        <input type="hidden" name="connectionId" value={c.id} />
                        <input type="hidden" name="clientId" value={client.id} />
                        <button className={`${btnSecondary} ${btnSm}`} title="Read the workspace's site list again">
                          Re-import sites
                        </button>
                      </form>
                      <form action={disconnectWorkspace}>
                        <input type="hidden" name="connectionId" value={c.id} />
                        <input type="hidden" name="clientId" value={client.id} />
                        <ConfirmButton message="Disconnect this workspace? Its sites stay in the app but cannot be audited until reconnected." className={`${btnDanger} ${btnSm}`}>
                          Disconnect
                        </ConfirmButton>
                      </form>
                    </div>
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
          <div className="border-t border-line px-5 py-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Danger zone</div>
            <p className="mt-1 text-sm text-ink-2">
              Deleting the client removes its {sites.length} site{sites.length === 1 ? "" : "s"}, every audit, finding and fix proposal, and its Webflow connections. Nothing is changed in Webflow.
            </p>
            <form action={deleteClient} className="mt-3">
              <input type="hidden" name="clientId" value={client.id} />
              <ConfirmButton message={`Delete "${client.name}" and all of its audit history? This cannot be undone.`} className={btnDanger}>
                Delete client
              </ConfirmButton>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
