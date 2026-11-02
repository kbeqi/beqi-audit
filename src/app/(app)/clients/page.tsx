import type { Metadata } from "next";
import Link from "next/link";
import { requireTeam } from "@/app/gate";
import { dashboardData } from "@/lib/queries";
import { Card, CardHeader, EmptyState, Notice, PageHeader, ScoreRing, btnPrimary, hostOf, timeAgo } from "@/components/ui";


export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  await requireTeam("/clients");
  const { deleted } = await searchParams;
  const clients = await dashboardData();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="One site per client, imported from their connected Webflow workspace."
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
            const s = sites[0];
            return (
              <Card key={client.id}>
                <CardHeader
                  title={client.name}
                  description={s ? hostOf(s.site.baseUrl) : connected ? "No site chosen yet" : "Webflow not connected"}
                  actions={<ScoreRing score={s?.latest?.scoreOverall ?? null} size="md" label={s?.latest?.scoreOverall == null ? "No audits" : `Score ${s.latest.scoreOverall}`} />}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-xs text-ink-3">
                  <span>{s?.latest ? `Last audit ${timeAgo(s.latest.finishedAt)} · ${s.openFindings} open finding${s.openFindings === 1 ? "" : "s"}${s.pendingFixes ? ` · ${s.pendingFixes} fix${s.pendingFixes === 1 ? "" : "es"} to review` : ""}` : "No audit yet"}</span>
                  <Link href={`/clients/${client.id}`} className="font-medium text-accent hover:underline">
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
