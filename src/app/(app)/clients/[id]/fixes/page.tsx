import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clientDetail } from "@/lib/queries";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { ProposalRow } from "@/components/proposals";
import { Card, CardHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Fixes` : "Fixes" };
}

export default async function ClientFixes({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch> }) {
  const { id } = await params;
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, proposals, pendingFixes } = data;
  const done = proposals.filter((p) => !pendingFixes.includes(p));
  const back = `/clients/${client.id}/fixes`;
  const siteOf = (siteId: string) => sites.find((s) => s.site.id === siteId)?.site;
  // Quick wins first, then by risk (low first), then newest.
  const effortRank = { quick: 0, moderate: 1, large: 2 } as const;
  const riskRank = { low: 0, medium: 1, high: 2 } as const;
  const sortedPending = [...pendingFixes].sort((a, b) => effortRank[a.effort ?? "moderate"] - effortRank[b.effort ?? "moderate"] || riskRank[a.risk ?? "medium"] - riskRank[b.risk ?? "medium"] || (a.createdAt < b.createdAt ? 1 : -1));
  const quickWins = sortedPending.filter((p) => p.effort === "quick").length;

  return (
    <div className="space-y-6">
      <ClientNotices q={q} />
      <Card>
        <CardHeader
          title="Fixes to review"
          count={pendingFixes.length}
          description={`Changes Claude proposed for this client${quickWins ? `, quick wins first (${quickWins})` : ""}. Approve & apply lets Claude make the change in Webflow and verify it; Fixed manually records a change you made yourself; Reject drops it.`}
        />
        {pendingFixes.length === 0 ? (
          <EmptyState title="Nothing to review" body="New proposals appear here after each audit." />
        ) : (
          <ul className="divide-y divide-line">
            {sortedPending.map((p) => (
              <ProposalRow key={p.id} proposal={p} site={sites.length > 1 ? siteOf(p.siteId) : undefined} back={back} />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="History" count={done.length} description="Applied, fixed manually, rejected or failed" />
        {done.length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <ul className="divide-y divide-line">
            {done.slice(0, 40).map((p) => (
              <ProposalRow key={p.id} proposal={p} site={sites.length > 1 ? siteOf(p.siteId) : undefined} back={back} compact />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
