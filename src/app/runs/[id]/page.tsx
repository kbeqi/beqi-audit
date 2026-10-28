import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { runDetail } from "@/lib/queries";
import { FindingsList } from "@/components/findings";
import { LiveLog } from "@/components/live-log";
import { Markdown } from "@/components/markdown";
import { ProposalRow } from "@/components/proposals";
import { runNow } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardHeader, Crumbs, KeyValue, Notice, PageHeader, ScoreRing, StatTile, StatusPill, btnSecondary, btnSm, fmtCost, fmtDate, fmtDuration, fmtNumber } from "@/components/ui";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/audit/score";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, id), columns: { siteId: true, status: true } });
  const site = run ? await db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId), columns: { name: true } }) : null;
  return { title: site ? `Audit · ${site.name}${run?.status === "running" ? " (running)" : ""}` : "Audit" };
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await runDetail(id);
  if (!data) notFound();
  const { run, site, client, findings, stateByFp, proposals, events } = data;
  const live = run.status === "queued" || run.status === "running";
  const visible = findings.filter((f) => {
    const s = stateByFp.get(f.fingerprint);
    return !(s && (s.status === "ignored" || s.status === "false_positive"));
  });
  const newFps = new Set(findings.filter((f) => stateByFp.get(f.fingerprint)?.firstSeenRunId === run.id).map((f) => f.fingerprint));
  const sevTotal = run.summary ? Object.values(run.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : 0;
  const openProposals = proposals.filter((p) => p.status === "proposed" || p.status === "approved" || p.status === "applying");

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/runs", label: "Audits" }, ...(client ? [{ href: `/clients/${client.id}`, label: client.name }] : []), { href: `/sites/${site.id}`, label: site.name }, { label: fmtDate(run.createdAt) }]} />
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusPill status={run.status} />
            <span>{run.trigger} audit</span>
            {run.model && <span className="font-mono">{run.model}</span>}
          </span>
        }
        title={site.name}
        description={run.finishedAt ? `Finished ${fmtDate(run.finishedAt)} · ${fmtDuration(run.usage?.durationMs)}` : `Started ${fmtDate(run.startedAt ?? run.createdAt)}`}
        actions={run.status === "complete" ? <ScoreRing score={run.scoreOverall} size="lg" /> : undefined}
      />

      {run.error && (
        <Notice tone="critical">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-words">Audit failed: {run.error}</span>
            <form action={runNow}>
              <input type="hidden" name="siteId" value={site.id} />
              <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Starting…">Run again</SubmitButton>
            </form>
          </div>
        </Notice>
      )}
      {live && (
        <Notice tone="accent">
          Claude is auditing the site through Webflow&apos;s MCP server and the live URL — reading only, nothing is changed. Audits usually take 5–10 minutes; this page updates as it works, and you can leave and come back.
        </Notice>
      )}

      <Card>
        <CardHeader title="Agent activity" description={live ? "Live" : `${events.length} events`} />
        <LiveLog streamId={run.id} initial={events} live={live} compact={!live} startedAt={run.startedAt ?? run.createdAt} />
      </Card>

      {run.status === "complete" && run.summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Pages reviewed" value={<span className="num">{run.summary.pagesReviewed}</span>} hint={`of ${run.summary.pagesTotal} static pages`} />
            <StatTile label="Findings" value={<span className="num">{sevTotal}</span>} hint={`${run.summary.findingsBySeverity.critical} critical · ${run.summary.findingsBySeverity.high} high · ${run.summary.findingsBySeverity.medium} medium`} />
            <StatTile label="Changes since last audit" value={<span className="num">{run.summary.newFindings}</span>} hint={`new · ${run.summary.resolvedFindings} resolved`} />
            <StatTile label="Cost" value={fmtCost(run.usage?.estimatedCostUsd)} hint={run.usage ? `${fmtNumber(run.usage.inputTokens + run.usage.cacheReadTokens)} in · ${fmtNumber(run.usage.outputTokens)} out · ${run.usage.toolCalls} tool calls` : undefined} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {CATEGORY_ORDER.map((cat) => (
              <div key={cat} className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="text-xs font-medium text-ink-3">{CATEGORY_LABELS[cat]}</div>
                <div className="mt-1 flex items-end justify-between">
                  <div className="text-2xl font-semibold leading-none text-ink">{run.scores?.[cat] ?? "–"}</div>
                  <div className="text-xs text-ink-3 num">{run.summary!.findingsByCategory[cat] ?? 0}</div>
                </div>
              </div>
            ))}
          </div>

          {run.agentSummary && (
            <Card>
              <CardHeader title="Claude's summary" />
              <div className="grid gap-5 p-5 lg:grid-cols-[1fr_18rem]">
                <Markdown text={run.agentSummary} />
                {run.highlights && run.highlights.length > 0 && (
                  <div className="rounded-lg bg-surface-2 p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Highlights</div>
                    <ul className="space-y-1.5 text-sm text-ink-2">
                      {run.highlights.map((h, i) => (
                        <li key={i} className="flex gap-2">
                          <span aria-hidden className="text-accent">
                            ▸
                          </span>
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}

          {openProposals.length > 0 && (
            <Card>
              <CardHeader title="Fixes proposed in this audit" count={openProposals.length} />
              <ul className="divide-y divide-line">
                {openProposals.map((p) => (
                  <ProposalRow key={p.id} proposal={p} back={`/runs/${run.id}`} />
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Findings" count={visible.length} />
            <FindingsList findings={visible} siteId={site.id} baseUrl={site.baseUrl} back={`/runs/${run.id}`} proposals={proposals} newFingerprints={newFps} showIgnored />
          </Card>
        </>
      )}

      <Card>
        <CardHeader title="Run details" />
        <div className="p-5">
          <KeyValue
            items={[
              { k: "Run id", v: <span className="font-mono text-xs">{run.id}</span> },
              { k: "Workflow", v: <span className="font-mono text-xs">{run.workflowInstanceId ?? "inline"}</span> },
              { k: "Site", v: <Link href={`/sites/${site.id}`} className="text-accent hover:underline">{site.name}</Link> },
              { k: "Model", v: run.model ?? "—" },
              { k: "API calls", v: run.usage?.apiCalls ?? "—" },
              { k: "Web fetches", v: run.usage?.webFetches ?? "—" },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
