import Link from "next/link";
import { notFound } from "next/navigation";
import { runDetail } from "@/lib/queries";
import { FindingsList } from "@/components/findings";
import { Card, ScoreBadge, StatusPill, fmtDate } from "@/components/ui";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/audit/score";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await runDetail(id);
  if (!data) notFound();
  const { run, site, findings, stateByFp } = data;
  const inProgress = run.status === "queued" || run.status === "running";
  const visible = findings.filter((f) => {
    const s = stateByFp.get(f.fingerprint);
    return !(s && (s.status === "ignored" || s.status === "false_positive"));
  });
  const newCount = findings.filter((f) => stateByFp.get(f.fingerprint)?.firstSeenRunId === run.id).length;

  return (
    <div className="space-y-6">
      {inProgress && <meta httpEquiv="refresh" content="10" />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-500">
            <Link href={`/sites/${site.id}`} className="hover:underline">
              {site.name}
            </Link>
          </div>
          <h1 className="text-xl font-semibold">Audit run · {fmtDate(run.createdAt)}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-zinc-600">
            <StatusPill status={run.status} /> <span>{run.trigger}</span>
            {run.finishedAt && <span>· finished {fmtDate(run.finishedAt)}</span>}
            {run.workflowInstanceId && <span className="font-mono text-xs">· workflow {run.workflowInstanceId}</span>}
          </div>
        </div>
        <ScoreBadge score={run.scoreOverall} size="lg" />
      </div>

      {run.error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Run failed: {run.error}</div>}
      {inProgress && <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">Audit in progress. This page refreshes every 10 seconds.</div>}

      {run.summary && (
        <div className="grid gap-3 md:grid-cols-6">
          {CATEGORY_ORDER.map((cat) => (
            <Card key={cat} className="flex items-center justify-between !p-3">
              <div>
                <div className="text-xs text-zinc-500">{CATEGORY_LABELS[cat]}</div>
                <div className="text-xs text-zinc-500">{run.summary!.findingsByCategory[cat] ?? 0} findings</div>
              </div>
              <ScoreBadge score={run.scores?.[cat]} />
            </Card>
          ))}
        </div>
      )}

      {run.summary && (
        <Card className="text-sm text-zinc-700">
          {run.summary.pagesCrawled} pages crawled · {run.summary.findingsBySeverity.critical} critical, {run.summary.findingsBySeverity.high} high, {run.summary.findingsBySeverity.medium} medium, {run.summary.findingsBySeverity.low} low, {run.summary.findingsBySeverity.info} info · {newCount} first seen in this run · {run.summary.resolvedFindings} resolved
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold">Findings</h2>
        <FindingsList findings={visible} siteId={site.id} baseUrl={site.baseUrl} back={`/runs/${run.id}`} showIgnored />
      </section>
    </div>
  );
}
