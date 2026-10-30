import type { Metadata } from "next";
import Link from "next/link";
import { requireSignedIn } from "@/app/gate";
import { currentActorOrNull } from "@/lib/auth";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { runDetail } from "@/lib/queries";
import { CategorySections } from "@/components/category-sections";
import { RunMonitor } from "@/components/run-progress";
import { Markdown } from "@/components/markdown";
import { ProposalRow } from "@/components/proposals";
import { runNow, shareRun, unshareRun } from "@/app/actions";
import { CopyField } from "@/components/copy-field";
import { appUrl, getEnv } from "@/lib/env";
import { SubmitButton } from "@/components/submit-button";
import { AiVisibilityCard, PerformanceCard } from "@/components/insights";
import { Card, CardHeader, Crumbs, KeyValue, Notice, PageHeader, ScoreRing, StatTile, StatusPill, btnPrimary, btnSecondary, btnSm, fmtCost, fmtDate, fmtDuration, fmtNumber, triggerLabel } from "@/components/ui";


export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await currentActorOrNull())) return { title: "Sign in" };
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, id), columns: { siteId: true, status: true } });
  const site = run ? await db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId), columns: { name: true } }) : null;
  return { title: site ? `Audit · ${site.name}${run?.status === "running" ? " (running)" : ""}` : "Audit" };
}

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ shared?: string; unshared?: string; error?: string }> }) {
  const { id } = await params;
  const { shared, unshared, error } = await searchParams;
  await requireSignedIn(`/runs/${id}`);
  const data = await runDetail(id);
  if (!data) notFound();
  const { run, site, client, findings, stateByFp, proposals, events, metrics, aiAnswers, recentDurations } = data;
  const live = run.status === "queued" || run.status === "running";
  const regressions = run.summary?.regressions;
  const visible = findings.filter((f) => {
    const s = stateByFp.get(f.fingerprint);
    return !(s && (s.status === "ignored" || s.status === "false_positive"));
  });
  const newFps = new Set(findings.filter((f) => stateByFp.get(f.fingerprint)?.firstSeenRunId === run.id).map((f) => f.fingerprint));
  const sevTotal = run.summary ? Object.values(run.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : 0;
  const openProposals = proposals.filter((p) => p.status === "proposed" || p.status === "approved" || p.status === "applying");
  const env = await getEnv();
  const shareUrl = run.shareToken ? `${appUrl(env)}/share/${run.shareToken}` : null;

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/clients", label: "Clients" }, ...(client ? [{ href: `/clients/${client.id}`, label: client.name }, { href: `/clients/${client.id}/audits`, label: "Audits" }] : []), { label: `${site.name} · ${fmtDate(run.createdAt)}` }]} />
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusPill status={run.status} />
            <span>{triggerLabel(run.trigger)} audit</span>
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
      {error && <Notice tone="critical">{decodeURIComponent(error)}</Notice>}
      {unshared && <Notice tone="good">Sharing stopped. The old link no longer works.</Notice>}
      {live && (
        <Notice tone="accent">
          {run.trigger === "publish" ? "The site was just published, so Claude is checking it again. " : ""}Claude is auditing the site through Webflow&apos;s MCP server and the live URL — reading only, nothing is changed. Audits usually take 5–10 minutes; this page updates as it works, and you can leave and come back.
        </Notice>
      )}
      {run.status === "complete" && run.trigger === "publish" && regressions && (
        <Notice tone={regressions.newCriticalHigh > 0 || (regressions.scoreDelta ?? 0) < -5 ? "serious" : "good"}>
          <strong>Post-publish check.</strong>{" "}
          {regressions.newCriticalHigh > 0
            ? `${regressions.newCriticalHigh} new critical or high finding${regressions.newCriticalHigh === 1 ? "" : "s"} since the last audit.`
            : "No new critical or high findings since the last audit."}
          {regressions.scoreDelta !== null && ` Score ${regressions.scoreDelta > 0 ? "up" : regressions.scoreDelta < 0 ? "down" : "unchanged"}${regressions.scoreDelta ? ` ${Math.abs(regressions.scoreDelta)}` : ""}.`}
        </Notice>
      )}

      {run.status === "complete" && (
        <Card>
          <CardHeader
            title="Share this report"
            description={shareUrl ? `Anyone with the link can read it — no sign-in. Shared by ${run.sharedBy ?? "—"} on ${fmtDate(run.sharedAt)}.` : "Create a read-only link to send to the client. It shows the score, summary and findings; nothing internal."}
            actions={
              shareUrl ? (
                <form action={unshareRun}>
                  <input type="hidden" name="runId" value={run.id} />
                  <SubmitButton className={`${btnSecondary} ${btnSm}`} confirm="Stop sharing? The link stops working for everyone who has it." pendingLabel="Stopping…">
                    Stop sharing
                  </SubmitButton>
                </form>
              ) : (
                <form action={shareRun}>
                  <input type="hidden" name="runId" value={run.id} />
                  <SubmitButton className={`${btnPrimary} ${btnSm}`} pendingLabel="Creating link…">
                    Create share link
                  </SubmitButton>
                </form>
              )
            }
          />
          {shareUrl && (
            <div className="space-y-2 p-5">
              {shared && <p className="text-sm text-good-text">Link ready — copy it below.</p>}
              <CopyField value={shareUrl} label="Share link" />
              <p className="text-xs text-ink-3">
                <Link href={`/share/${run.shareToken}`} target="_blank" className="text-accent hover:underline">
                  Preview what they&apos;ll see
                </Link>
              </p>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title={live ? "Audit in progress" : "Agent activity"} description={live ? "The time estimate comes from this site's previous audits and the pages read so far." : `${events.length} events`} />
        <RunMonitor streamId={run.id} initial={events} live={live} compact={!live} startedAt={run.startedAt ?? run.createdAt} pageBudget={Math.min(site.maxPages, 40)} recentDurations={recentDurations} />
      </Card>

      {run.status === "complete" && run.summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Pages reviewed" value={<span className="num">{run.summary.pagesReviewed}</span>} hint={`of ${run.summary.pagesTotal} static pages`} />
            <StatTile label="Findings" value={<span className="num">{sevTotal}</span>} hint={`${run.summary.findingsBySeverity.critical} critical · ${run.summary.findingsBySeverity.high} high · ${run.summary.findingsBySeverity.medium} medium`} />
            <StatTile label="Changes since last audit" value={<span className="num">{run.summary.newFindings}</span>} hint={`new · ${run.summary.resolvedFindings} resolved`} />
            <StatTile label="Cost" value={fmtCost(run.usage?.estimatedCostUsd)} hint={run.usage ? `${fmtNumber(run.usage.inputTokens + run.usage.cacheReadTokens)} in · ${fmtNumber(run.usage.outputTokens)} out · ${run.usage.toolCalls} tool calls` : undefined} />
          </div>

          <section aria-labelledby="areas" className="space-y-3">
            <h2 id="areas" className="text-sm font-semibold text-ink">
              Scores and findings by area <span className="ml-1.5 text-xs font-medium text-ink-3 num">{visible.length}</span>
              <span className="ml-2 text-xs font-normal text-ink-3">100 means nothing was found in that area; open an area to see its findings.</span>
            </h2>
            <CategorySections scores={run.scores} findings={visible} siteId={site.id} baseUrl={site.baseUrl} back={`/runs/${run.id}`} proposals={proposals} newFingerprints={newFps} showIgnored aiSummary={run.summary.aiVisibility} />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <PerformanceCard metrics={metrics} unavailable={run.summary.perf?.unavailable} />
            <AiVisibilityCard summary={run.summary.aiVisibility} answers={aiAnswers} />
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
