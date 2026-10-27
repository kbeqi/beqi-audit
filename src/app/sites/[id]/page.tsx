import Link from "next/link";
import { notFound } from "next/navigation";
import { siteDetail } from "@/lib/queries";
import { deleteIgnoreRule, runNow, updateSiteSettings } from "@/app/actions";
import { FindingsList } from "@/components/findings";
import { Card, Delta, ScoreBadge, StatusPill, buttonCls, buttonSecondaryCls, fmtDate, inputCls } from "@/components/ui";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/audit/score";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await siteDetail(id);
  if (!data) notFound();
  const { site, client, runs, latest, findings, metrics, ignoreRules } = data;
  const completed = runs.filter((r) => r.status === "complete");
  const previous = completed[1] ?? null;
  const latestMetrics = latest ? metrics.filter((m) => m.runId === latest.id) : [];
  const back = `/sites/${site.id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-500">
            <Link href={`/clients/${client.id}`} className="hover:underline">
              {client.name}
            </Link>
          </div>
          <h1 className="text-xl font-semibold">{site.name}</h1>
          <a href={site.baseUrl} target="_blank" rel="noreferrer" className="text-sm text-sky-700 hover:underline">
            {site.baseUrl}
          </a>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ScoreBadge score={latest?.scoreOverall} size="lg" />
            <div className="text-xs text-zinc-500">
              <div>
                <Delta now={latest?.scoreOverall} before={previous?.scoreOverall} /> vs previous
              </div>
              <div>last audit {fmtDate(latest?.finishedAt)}</div>
            </div>
          </div>
          <form action={runNow}>
            <input type="hidden" name="siteId" value={site.id} />
            <button className={buttonCls} disabled={!site.connectionId}>
              Run audit now
            </button>
          </form>
        </div>
      </div>

      {!site.connectionId && <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This site has no active Webflow connection. Reconnect the client&apos;s workspace to audit it.</div>}

      {latest && (
        <div className="grid gap-3 md:grid-cols-6">
          {CATEGORY_ORDER.map((cat) => (
            <Card key={cat} className="flex items-center justify-between !p-3">
              <div>
                <div className="text-xs text-zinc-500">{CATEGORY_LABELS[cat]}</div>
                <div className="text-xs text-zinc-500">{latest.summary?.findingsByCategory[cat] ?? 0} findings</div>
              </div>
              <div className="flex items-center gap-1">
                <ScoreBadge score={latest.scores?.[cat]} />
                <Delta now={latest.scores?.[cat]} before={previous?.scores?.[cat]} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {latest?.summary && (
        <Card className="text-sm text-zinc-700">
          Crawled {latest.summary.pagesCrawled} pages · {latest.summary.newFindings} new, {latest.summary.resolvedFindings} resolved since the previous run
          {latest.summary.changedSinceLastRun && latest.summary.changedSinceLastRun.length > 0 && (
            <>
              {" "}
              · changed since last run: <span className="font-medium">{latest.summary.changedSinceLastRun.join(", ")}</span>
            </>
          )}
        </Card>
      )}

      {latestMetrics.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Performance (PageSpeed Insights)</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-1 pr-3">Page</th>
                <th className="py-1 pr-3">Device</th>
                <th className="py-1 pr-3">Score</th>
                <th className="py-1 pr-3">LCP</th>
                <th className="py-1 pr-3">CLS</th>
                <th className="py-1 pr-3">TBT</th>
                <th className="py-1 pr-3">Weight</th>
                <th className="py-1 pr-3">Field LCP / INP</th>
              </tr>
            </thead>
            <tbody>
              {latestMetrics.map((m) => (
                <tr key={m.id} className="border-t border-zinc-100">
                  <td className="py-1 pr-3 font-mono text-xs">{m.pagePath}</td>
                  <td className="py-1 pr-3">{m.strategy}</td>
                  <td className="py-1 pr-3">
                    <ScoreBadge score={m.performanceScore} />
                  </td>
                  <td className="py-1 pr-3">{m.lcpMs != null ? `${(m.lcpMs / 1000).toFixed(1)}s` : "—"}</td>
                  <td className="py-1 pr-3">{m.cls != null ? m.cls.toFixed(2) : "—"}</td>
                  <td className="py-1 pr-3">{m.tbtMs != null ? `${Math.round(m.tbtMs)}ms` : "—"}</td>
                  <td className="py-1 pr-3">{m.totalBytes != null ? `${(m.totalBytes / 1_000_000).toFixed(1)} MB` : "—"}</td>
                  <td className="py-1 pr-3">
                    {m.fieldLcpMs != null ? `${(m.fieldLcpMs / 1000).toFixed(1)}s` : "—"} / {m.fieldInpMs != null ? `${Math.round(m.fieldInpMs)}ms` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold">Open findings {latest && <span className="text-sm font-normal text-zinc-500">({findings.length}, from the latest audit)</span>}</h2>
        {latest ? <FindingsList findings={findings} siteId={site.id} baseUrl={site.baseUrl} back={back} /> : <p className="text-sm text-zinc-500">No completed audit yet.</p>}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-zinc-500">No runs yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-1 pr-3">
                      <Link href={`/runs/${r.id}`} className="hover:underline">
                        {fmtDate(r.createdAt)}
                      </Link>
                    </td>
                    <td className="py-1 pr-3 text-zinc-600">{r.trigger}</td>
                    <td className="py-1 pr-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="py-1 pr-3">
                      <ScoreBadge score={r.scoreOverall} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold">Settings</h2>
          <form action={updateSiteSettings} className="space-y-3 text-sm">
            <input type="hidden" name="siteId" value={site.id} />
            <label className="block">
              <span className="mb-1 block font-medium">Audit frequency</span>
              <select name="auditFrequency" defaultValue={site.auditFrequency} className={inputCls}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="off">Off (manual and publish-triggered only)</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Base URL</span>
              <input name="baseUrl" defaultValue={site.baseUrl} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Key pages (PageSpeed runs; one per line, max 5)</span>
              <textarea name="keyPages" rows={3} defaultValue={site.keyPages.join("\n")} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Max pages to crawl</span>
              <input name="maxPages" type="number" min={10} max={1000} defaultValue={site.maxPages} className={inputCls} />
            </label>
            <label className="flex items-center gap-2">
              <input name="isEnterprise" type="checkbox" defaultChecked={site.isEnterprise} />
              <span>Enterprise plan (Analyze / AEO analytics available)</span>
            </label>
            <button className={buttonSecondaryCls}>Save settings</button>
          </form>

          {ignoreRules.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Ignore rules</h3>
              <ul className="space-y-1 text-xs">
                {ignoreRules.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="font-mono">
                      {r.checkId} {r.pagePath ? `on ${r.pagePath}` : "(whole site)"}
                    </span>
                    <form action={deleteIgnoreRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="siteId" value={site.id} />
                      <button className="text-red-700 hover:underline">remove</button>
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
