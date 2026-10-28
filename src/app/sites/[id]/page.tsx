import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Severity } from "@/db/schema";
import { siteDetail } from "@/lib/queries";
import { deleteIgnoreRule, runNow, updateSiteSettings } from "@/app/actions";
import { FindingsList } from "@/components/findings";
import { SubmitButton } from "@/components/submit-button";
import { Markdown } from "@/components/markdown";
import { ProposalRow } from "@/components/proposals";
import { Card, CardHeader, Crumbs, Delta, EmptyState, Notice, PageHeader, ScoreRing, Sparkline, StatusPill, btnPrimary, btnSecondary, btnSm, fmtCost, fmtDate, fmtDay, fmtDuration, hostOf, inputCls, labelCls, scoreTone, timeAgo } from "@/components/ui";
import { CATEGORY_LABELS, CATEGORY_ORDER, SEVERITY_ORDER } from "@/audit/score";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = await getDb();
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, id), columns: { name: true } });
  return { title: site?.name ?? "Site" };
}

export default async function SitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sev?: string; saved?: string }> }) {
  const { id } = await params;
  const { sev, saved } = await searchParams;
  const data = await siteDetail(id);
  if (!data) notFound();
  const { site, client, connection, runs, latest, previous, findings, stateByFp, proposals, ignoreRules } = data;
  const running = runs.find((r) => r.status === "running" || r.status === "queued") ?? null;
  const history = runs.filter((r) => r.status === "complete").map((r) => r.scoreOverall).reverse().slice(-12);
  const back = `/sites/${site.id}`;
  const severity = (SEVERITY_ORDER as string[]).includes(sev ?? "") ? (sev as Severity) : "all";
  const newFps = new Set(findings.filter((f) => stateByFp.get(f.fingerprint)?.firstSeenRunId === latest?.id).map((f) => f.fingerprint));
  const openProposals = proposals.filter((p) => p.status === "proposed" || p.status === "approved" || p.status === "applying" || p.status === "failed");
  const doneProposals = proposals.filter((p) => p.status === "applied" || p.status === "rejected").slice(0, 10);
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/clients", label: "Clients" }, { href: `/clients/${client.id}`, label: client.name }, { label: site.name }]} />
      <PageHeader
        title={site.name}
        description={
          <a href={site.baseUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {hostOf(site.baseUrl)}
          </a>
        }
        actions={
          <>
            {running && (
              <Link href={`/runs/${running.id}`} className={btnSecondary}>
                <StatusPill status={running.status} /> View progress
              </Link>
            )}
            <form action={runNow}>
              <input type="hidden" name="siteId" value={site.id} />
              <SubmitButton className={btnPrimary} disabled={!connection || !!running} pendingLabel="Starting audit…">
                {running ? "Audit running" : latest ? "Run audit now" : "Run first audit"}
              </SubmitButton>
            </form>
          </>
        }
      />

      {saved && <Notice tone="good">Settings saved.</Notice>}
      {!connection && (
        <Notice tone="warn">
          This site has no active Webflow connection.{" "}
          <Link href={`/clients/${client.id}`} className="font-medium underline">
            Reconnect the workspace
          </Link>{" "}
          to audit it.
        </Notice>
      )}
      {connection && !latest && !running && (
        <Notice tone="accent">
          <strong>Ready for its first audit.</strong> Claude reviews up to {site.maxPages} pages through Webflow and the live site; expect 5–10 minutes. Nothing is changed on the site during an audit.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <Card className="flex items-center gap-5 px-6 py-5">
          <ScoreRing score={latest?.scoreOverall} size="xl" />
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-ink-3">Overall score</div>
            <div>
              <Delta now={latest?.scoreOverall} before={previous?.scoreOverall} /> <span className="text-xs text-ink-3">vs previous audit</span>
            </div>
            <div className="text-xs text-ink-3">Last audit {latest ? timeAgo(latest.finishedAt) : "—"}</div>
            <div className="text-xs text-ink-3">Next {site.auditFrequency === "off" ? "manual only" : fmtDay(site.nextRunAt)}</div>
            {history.length >= 2 && (
              <div className="pt-1">
                <Sparkline values={history} width={140} height={32} />
              </div>
            )}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CATEGORY_ORDER.map((cat) => {
            const score = latest?.scores?.[cat];
            const tone = scoreTone(score);
            return (
              <div key={cat} className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-ink-3">{CATEGORY_LABELS[cat]}</div>
                  <Delta now={score} before={previous?.scores?.[cat]} />
                </div>
                <div className="mt-1 flex items-end justify-between">
                  <div className={`text-2xl font-semibold leading-none ${tone === "critical" ? "text-critical" : "text-ink"}`}>{score ?? "–"}</div>
                  <div className="text-xs text-ink-3 num">{latest?.summary?.findingsByCategory[cat] ?? 0} findings</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {latest?.agentSummary && (
        <Card>
          <CardHeader
            title="Claude's summary"
            description={`From the audit on ${fmtDate(latest.finishedAt)} · ${latest.summary?.pagesReviewed ?? 0} of ${latest.summary?.pagesTotal ?? 0} pages reviewed · ${fmtDuration(latest.usage?.durationMs)} · ${fmtCost(latest.usage?.estimatedCostUsd)}`}
            actions={
              <Link href={`/runs/${latest.id}`} className="text-xs font-medium text-accent hover:underline">
                Full run
              </Link>
            }
          />
          <div className="grid gap-5 p-5 lg:grid-cols-[1fr_18rem]">
            <Markdown text={latest.agentSummary} />
            {latest.highlights && latest.highlights.length > 0 && (
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Highlights</div>
                <ul className="space-y-1.5 text-sm text-ink-2">
                  {latest.highlights.map((h, i) => (
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

      <Card id="fixes">
        <CardHeader title="Proposed fixes" count={openProposals.length} description="Nothing is written to Webflow until you approve it. Applied changes go live on the site's next publish." />
        {openProposals.length === 0 ? (
          <EmptyState title="No fixes waiting" body={latest ? "Claude found nothing it can safely fix automatically, or everything has been reviewed." : "Run an audit to get fix proposals."} />
        ) : (
          <ul className="divide-y divide-line">
            {openProposals.map((p) => (
              <ProposalRow key={p.id} proposal={p} back={`${back}#fixes`} />
            ))}
          </ul>
        )}
        {doneProposals.length > 0 && (
          <details className="border-t border-line">
            <summary className="px-5 py-2.5 text-xs font-medium text-ink-3 hover:text-ink">Recently applied or rejected ({doneProposals.length})</summary>
            <ul className="divide-y divide-line border-t border-line">
              {doneProposals.map((p) => (
                <ProposalRow key={p.id} proposal={p} back={`${back}#fixes`} />
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Open findings"
          count={findings.length}
          description={latest ? `From the latest audit · ${latest.summary?.newFindings ?? 0} new, ${latest.summary?.resolvedFindings ?? 0} resolved since the previous one` : undefined}
          actions={
            latest && (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by severity">
                {(["all", ...SEVERITY_ORDER] as const).map((s) => (
                  <Link
                    key={s}
                    href={s === "all" ? back : `${back}?sev=${s}`}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${severity === s ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
                    aria-current={severity === s ? "true" : undefined}
                  >
                    {s === "all" ? "All" : `${s} ${counts[s] ? counts[s] : ""}`.trim()}
                  </Link>
                ))}
              </div>
            )
          }
        />
        {latest ? (
          <FindingsList findings={findings} siteId={site.id} baseUrl={site.baseUrl} back={back} proposals={proposals} newFingerprints={newFps} severity={severity} />
        ) : (
          <EmptyState title="No completed audit yet" body="Run an audit to see findings." />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Audit history" count={runs.length} />
          {runs.length === 0 ? (
            <EmptyState title="No audits yet" />
          ) : (
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Findings</th>
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
                    <td className="text-ink-2">{r.trigger}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="num">{r.scoreOverall ?? "—"}</td>
                    <td className="num text-ink-2">{r.summary ? Object.values(r.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : "—"}</td>
                    <td className="num text-ink-2">{fmtCost(r.usage?.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader title="Settings" />
          <form action={updateSiteSettings} className="space-y-3 p-5 text-sm">
            <input type="hidden" name="siteId" value={site.id} />
            <div>
              <label htmlFor="auditFrequency" className={labelCls}>
                Audit schedule
              </label>
              <select id="auditFrequency" name="auditFrequency" defaultValue={site.auditFrequency} className={inputCls}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="off">Off (manual only)</option>
              </select>
            </div>
            <div>
              <label htmlFor="baseUrl" className={labelCls}>
                Live URL
              </label>
              <input id="baseUrl" name="baseUrl" defaultValue={site.baseUrl} className={inputCls} />
            </div>
            <div>
              <label htmlFor="keyPages" className={labelCls}>
                Key pages (always reviewed first; one per line)
              </label>
              <textarea id="keyPages" name="keyPages" rows={3} defaultValue={site.keyPages.join("\n")} className={inputCls} />
            </div>
            <div>
              <label htmlFor="maxPages" className={labelCls}>
                Pages to review per audit (5–200)
              </label>
              <input id="maxPages" name="maxPages" type="number" min={5} max={200} defaultValue={site.maxPages} className={inputCls} />
              <p className="mt-1 text-xs text-ink-3">More pages means a longer, costlier audit. 40 covers most marketing sites.</p>
            </div>
            <label className="flex items-center gap-2 text-ink-2">
              <input name="isEnterprise" type="checkbox" defaultChecked={site.isEnterprise} />
              Enterprise plan (Analyze / AEO analytics available)
            </label>
            <SubmitButton className={btnSecondary} pendingLabel="Saving…">Save settings</SubmitButton>
          </form>

          {ignoreRules.length > 0 && (
            <div className="border-t border-line p-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Ignore rules</h3>
              <ul className="space-y-1.5 text-xs">
                {ignoreRules.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-ink-2">
                      {r.checkId} {r.pagePath ? `on ${r.pagePath}` : "(whole site)"}
                    </span>
                    <form action={deleteIgnoreRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="siteId" value={site.id} />
                      <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Removing…">Remove</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
