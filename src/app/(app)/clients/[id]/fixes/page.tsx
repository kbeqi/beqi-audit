import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canSeeClient, requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { clientDetail } from "@/lib/queries";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { ProposalRow } from "@/components/proposals";
import { Card, CardHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "Fixes" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Fixes` : "Fixes" };
}

export default async function ClientFixes({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch> }) {
  const { id } = await params;
  const team = isTeam(await requireClientAccess(id, `/clients/${id}/fixes`));
  const role = team ? "team" : "client";
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, proposals, pendingFixes } = data;
  // For the client, "waiting for you" is only what they can still decide;
  // things they approved and Beqi still has to apply sit in the history.
  const waiting = team ? pendingFixes : pendingFixes.filter((p) => p.status === "proposed");
  const done = proposals.filter((p) => !waiting.includes(p));
  const back = `/clients/${client.id}/fixes`;
  const siteOf = (siteId: string) => sites.find((s) => s.site.id === siteId)?.site;
  // Quick wins first, then by risk (low first), then newest.
  const effortRank = { quick: 0, moderate: 1, large: 2 } as const;
  const riskRank = { low: 0, medium: 1, high: 2 } as const;
  const sortedPending = [...waiting].sort((a, b) => effortRank[a.effort ?? "moderate"] - effortRank[b.effort ?? "moderate"] || riskRank[a.risk ?? "medium"] - riskRank[b.risk ?? "medium"] || (a.createdAt < b.createdAt ? 1 : -1));
  const quickWins = sortedPending.filter((p) => p.effort === "quick").length;
  const awaitingBeqi = done.filter((p) => p.status === "client_approved" || p.status === "approved" || p.status === "applying").length;

  return (
    <div className="space-y-6">
      <ClientNotices q={q} />
      <Card>
        <CardHeader
          title={team ? "Fixes to review" : "Waiting for your approval"}
          count={waiting.length}
          description={
            team
              ? `Changes Claude proposed for this client${quickWins ? `, quick wins first (${quickWins})` : ""}. Approve & apply lets Claude make the change in Webflow and verify it; Fixed manually records a change you made yourself; Reject drops it.`
              : `Changes Beqi recommends for your site${quickWins ? `, quick wins first (${quickWins})` : ""}. Nothing is changed until you approve it. Small, safe changes are applied right away; anything larger is applied by Beqi after your approval.`
          }
        />
        {waiting.length === 0 ? (
          <EmptyState title={team ? "Nothing to review" : "Nothing waiting for you"} body="New proposals appear here after each audit." />
        ) : (
          <ul className="divide-y divide-line">
            {sortedPending.map((p) => (
              <ProposalRow key={p.id} proposal={p} site={sites.length > 1 ? siteOf(p.siteId) : undefined} back={back} role={role} />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={team ? "History" : "Approved and done"} count={done.length} description={team ? "Applied, fixed manually, rejected or failed" : awaitingBeqi ? `${awaitingBeqi} approved and being applied by Beqi; the rest are done or declined` : "Applied, done by hand, or declined"} />
        {done.length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <ul className="divide-y divide-line">
            {done.slice(0, 40).map((p) => (
              <ProposalRow key={p.id} proposal={p} site={sites.length > 1 ? siteOf(p.siteId) : undefined} back={back} compact role={role} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
