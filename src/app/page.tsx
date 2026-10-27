import Link from "next/link";
import { dashboardData } from "@/lib/queries";
import { Card, Delta, ScoreBadge, fmtDate, buttonSecondaryCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const clients = await dashboardData();
  const allSites = clients.flatMap((c) => c.sites);
  const needsAttention = allSites
    .filter((s) => s.latest && (s.openBySeverity.critical > 0 || (s.latest.scoreOverall ?? 100) < 70))
    .sort((a, b) => (a.latest?.scoreOverall ?? 0) - (b.latest?.scoreOverall ?? 0));

  return (
    <div className="space-y-6">
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Something went wrong: {error}</div>}

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Portfolio</h1>
          <p className="text-sm text-zinc-500">
            {clients.length} client{clients.length === 1 ? "" : "s"}, {allSites.length} site{allSites.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link href="/clients/new" className={buttonSecondaryCls}>
          Add client
        </Link>
      </div>

      {needsAttention.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">Needs attention</h2>
          <ul className="space-y-1 text-sm">
            {needsAttention.map((s) => (
              <li key={s.site.id} className="flex items-center gap-3">
                <ScoreBadge score={s.latest?.scoreOverall} />
                <Link href={`/sites/${s.site.id}`} className="font-medium hover:underline">
                  {s.site.name}
                </Link>
                <span className="text-zinc-600">
                  {s.openBySeverity.critical} critical, {s.openBySeverity.high} high
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {clients.length === 0 && (
        <Card>
          <p className="text-sm text-zinc-600">
            No clients yet. <Link href="/clients/new" className="underline">Add the first client</Link>, then connect its Webflow workspace.
          </p>
        </Card>
      )}

      {clients.map(({ client, sites, connected }) => (
        <Card key={client.id}>
          <div className="mb-3 flex items-center justify-between">
            <Link href={`/clients/${client.id}`} className="text-base font-semibold hover:underline">
              {client.name}
            </Link>
            {!connected && (
              <Link href={`/api/webflow/authorize?client=${client.id}`} className="text-sm text-sky-700 underline">
                Connect Webflow
              </Link>
            )}
          </div>
          {sites.length === 0 ? (
            <p className="text-sm text-zinc-500">No sites imported yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-1 pr-3">Site</th>
                  <th className="py-1 pr-3">Score</th>
                  <th className="py-1 pr-3">Trend</th>
                  <th className="py-1 pr-3">Open issues</th>
                  <th className="py-1 pr-3">Last audit</th>
                  <th className="py-1 pr-3">Next</th>
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
                    <td className="py-2 pr-3 text-zinc-700">
                      {s.latest ? `${s.openBySeverity.critical} critical · ${s.openBySeverity.high} high · ${s.openBySeverity.medium} medium` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-zinc-600">{fmtDate(s.latest?.finishedAt)}</td>
                    <td className="py-2 pr-3 text-zinc-600">
                      {s.site.auditFrequency === "off" ? "off" : `${s.site.auditFrequency} · ${fmtDate(s.site.nextRunAt)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </div>
  );
}
