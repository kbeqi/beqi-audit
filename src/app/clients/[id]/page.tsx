import Link from "next/link";
import { notFound } from "next/navigation";
import { clientDetail } from "@/lib/queries";
import { runNow } from "@/app/actions";
import { Card, Delta, ScoreBadge, buttonCls, buttonSecondaryCls, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ connected?: string }> }) {
  const { id } = await params;
  const { connected } = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections } = data;
  const active = connections.filter((c) => !c.revokedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{client.name}</h1>
          {client.notes && <p className="mt-1 max-w-2xl text-sm text-zinc-600 whitespace-pre-line">{client.notes}</p>}
        </div>
        <Link href={`/api/webflow/authorize?client=${client.id}`} className={active.length ? buttonSecondaryCls : buttonCls}>
          {active.length ? "Connect another workspace" : "Connect Webflow"}
        </Link>
      </div>

      {connected && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Connected. {connected} site(s) imported; the first weekly audit is scheduled. Run one now from a site row to see results today.</div>}

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Webflow connections</h2>
        {active.length === 0 ? (
          <p className="text-sm text-zinc-500">Not connected. The client (or you, logged into their workspace) authorizes the Beqi app once per workspace.</p>
        ) : (
          <ul className="space-y-1 text-sm text-zinc-700">
            {active.map((c) => (
              <li key={c.id}>
                Workspace {c.workspaceName ?? c.workspaceId ?? "—"} · {c.authorizedSiteIds.length} site(s) · authorized by {c.authorizedBy ?? "—"} on {fmtDate(c.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Sites</h2>
        {sites.length === 0 ? (
          <p className="text-sm text-zinc-500">No sites yet. Sites are imported automatically when a workspace is connected.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-1 pr-3">Site</th>
                <th className="py-1 pr-3">Score</th>
                <th className="py-1 pr-3">Trend</th>
                <th className="py-1 pr-3">Schedule</th>
                <th className="py-1 pr-3">Last audit</th>
                <th className="py-1 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.site.id} className="border-t border-zinc-100">
                  <td className="py-2 pr-3">
                    <Link href={`/sites/${s.site.id}`} className="font-medium hover:underline">
                      {s.site.name}
                    </Link>
                    <div className="text-xs text-zinc-500">{s.site.baseUrl}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <ScoreBadge score={s.latest?.scoreOverall} />
                  </td>
                  <td className="py-2 pr-3">
                    <Delta now={s.latest?.scoreOverall} before={s.previous?.scoreOverall} />
                  </td>
                  <td className="py-2 pr-3 text-zinc-600">{s.site.auditFrequency}</td>
                  <td className="py-2 pr-3 text-zinc-600">{fmtDate(s.latest?.finishedAt)}</td>
                  <td className="py-2 pr-3 text-right">
                    <form action={runNow}>
                      <input type="hidden" name="siteId" value={s.site.id} />
                      <button className={buttonSecondaryCls}>Run now</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
