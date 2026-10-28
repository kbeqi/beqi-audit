import Link from "next/link";
import { requireSignedIn } from "@/app/gate";
import { dashboardData } from "@/lib/queries";
import { Card, CardHeader, EmptyState, Notice, PageHeader, ScoreRing, btnPrimary, hostOf } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  await requireSignedIn("/clients");
  const { deleted } = await searchParams;
  const clients = await dashboardData();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Each client has one or more connected Webflow workspaces; every site in a workspace is audited."
        actions={
          <Link href="/clients/new" className={btnPrimary}>
            Add client
          </Link>
        }
      />
      {deleted && <Notice tone="good">Deleted “{deleted}” and all of its audit history.</Notice>}
      {clients.length === 0 ? (
        <Card>
          <EmptyState title="No clients yet" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {clients.map(({ client, sites, connected }) => {
            const scored = sites.filter((s) => s.latest?.scoreOverall != null);
            const avg = scored.length ? Math.round(scored.reduce((a, s) => a + (s.latest!.scoreOverall ?? 0), 0) / scored.length) : null;
            return (
              <Card key={client.id}>
                <CardHeader
                  title={client.name}
                  description={connected ? `${sites.length} site${sites.length === 1 ? "" : "s"}` : "Webflow not connected"}
                  actions={<ScoreRing score={avg} size="md" label={avg == null ? "No audits" : `Average score ${avg}`} />}
                />
                <ul className="divide-y divide-line">
                  {sites.slice(0, 5).map((s) => (
                    <li key={s.site.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                      <Link href={`/sites/${s.site.id}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                        {s.site.name}
                      </Link>
                      <span className="truncate text-xs text-ink-3">{hostOf(s.site.baseUrl)}</span>
                    </li>
                  ))}
                  {sites.length > 5 && <li className="px-5 py-2 text-xs text-ink-3">+{sites.length - 5} more</li>}
                </ul>
                <div className="border-t border-line px-5 py-2.5">
                  <Link href={`/clients/${client.id}`} className="text-xs font-medium text-accent hover:underline">
                    Open client →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
