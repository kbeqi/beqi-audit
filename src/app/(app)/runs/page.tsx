import Link from "next/link";
import { requireSignedIn } from "@/app/gate";
import { recentRuns } from "@/lib/queries";
import { Card, EmptyState, PageHeader, StatusPill, fmtCost, fmtDate, fmtDuration, triggerLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  await requireSignedIn("/runs");
  const runs = await recentRuns(60);
  return (
    <div className="space-y-6">
      <PageHeader title="Audits" description="Every audit run across the portfolio, newest first." />
      <Card>
        {runs.length === 0 ? (
          <EmptyState title="No audits yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Site</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Pages</th>
                  <th>Findings</th>
                  <th>Duration</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/runs/${r.id}`} className="text-ink hover:underline">
                        {fmtDate(r.createdAt)}
                      </Link>
                    </td>
                    <td>
                      {r.site ? (
                        <Link href={`/sites/${r.site.id}`} className="font-medium text-ink hover:underline">
                          {r.site.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-ink-2">{triggerLabel(r.trigger)}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="num">{r.scoreOverall ?? "—"}</td>
                    <td className="num text-ink-2">{r.summary ? `${r.summary.pagesReviewed}/${r.summary.pagesTotal}` : "—"}</td>
                    <td className="num text-ink-2">{r.summary ? Object.values(r.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : "—"}</td>
                    <td className="num text-ink-2">{fmtDuration(r.usage?.durationMs)}</td>
                    <td className="num text-ink-2">{fmtCost(r.usage?.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
