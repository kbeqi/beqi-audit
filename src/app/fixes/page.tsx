import { requireSignedIn } from "@/app/gate";
import { pendingFixesAcrossPortfolio, proposalsByStatus } from "@/lib/queries";
import { ProposalRow } from "@/components/proposals";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FixesPage() {
  await requireSignedIn("/fixes");
  const [pending, done] = await Promise.all([pendingFixesAcrossPortfolio(), proposalsByStatus(["applied", "rejected", "failed"], 30)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Fixes" description="Changes Claude proposed during audits. Approve one and Claude applies it through Webflow's MCP server, then reads it back to verify." />
      <Card>
        <CardHeader title="Awaiting review" count={pending.length} />
        {pending.length === 0 ? (
          <EmptyState title="Nothing to review" body="New proposals appear here after each audit." />
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((p) => (
              <ProposalRow key={p.id} proposal={p} site={p.site} back="/fixes" />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Applied, rejected or failed" count={done.length} />
        {done.length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <ul className="divide-y divide-line">
            {done.map((p) => (
              <ProposalRow key={p.id} proposal={p} site={p.site} back="/fixes" />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
