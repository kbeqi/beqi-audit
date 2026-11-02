import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeClient, requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { clientAiTrend, clientDetail } from "@/lib/queries";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { ProposalRow } from "@/components/proposals";
import { Card, CardHeader, EmptyState, SeverityPill, btnSecondary, btnSm, fmtDay } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "AI answers" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · AI answers` : "AI answers" };
}

function pct(n: number, of: number): string {
  return of ? `${Math.round((n / of) * 100)}%` : "–";
}

// Bars for one metric across runs, oldest first.
type RunCounts = { answers: number; mentioned: number; cited: number; recommended: number };
function Trend({ runs, pick, label }: { runs: RunCounts[]; pick: (r: RunCounts) => number; label: string }) {
  return (
    <div className="flex h-10 items-end gap-1" role="img" aria-label={label}>
      {runs.map((r, i) => {
        const v = r.answers ? pick(r) / r.answers : 0;
        return <div key={i} className={`w-4 rounded-sm ${i === runs.length - 1 ? "bg-accent-bg" : "bg-line-2"}`} style={{ height: `${Math.max(6, v * 100)}%` }} title={`${Math.round(v * 100)}%`} />;
      })}
    </div>
  );
}

export default async function ClientAi({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch> }) {
  const { id } = await params;
  const team = isTeam(await requireClientAccess(id, `/clients/${id}/ai`));
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const trend = await clientAiTrend(id);
  const back = `/clients/${id}/ai`;

  return (
    <div className="space-y-6">
      <ClientNotices q={q} />
      <Card>
        <CardHeader title="AI answers check" description="Once a month, AI assistants (Perplexity and Claude) are asked a fixed set of questions a prospective customer would ask. This page shows which questions the brand is named in, cited for or recommended on, how that moves month to month, and what is being changed on the site in response. Answers vary from day to day: read this as a direction, not a score." />
        <p className="px-5 py-3 text-sm text-ink-2">
          The loop: <span className="font-medium text-ink">ask</span> the same questions each month → <span className="font-medium text-ink">check</span> the answers against the site&apos;s facts → <span className="font-medium text-ink">fix</span> the page that should answer (plain statements, schema, entity facts) → <span className="font-medium text-ink">ask again</span> next month.
        </p>
      </Card>

      {trend.length === 0 && (
        <Card>
          <EmptyState title="No sites yet" />
        </Card>
      )}

      {trend.map(({ site, runs, prompts, openClaims, contentFixes }) => {
        const latest = runs[runs.length - 1];
        const first = runs[0];
        const waiting = contentFixes.filter((p) => p.status === "proposed" || p.status === "client_approved" || p.status === "approved" || p.status === "applying");
        const done = contentFixes.filter((p) => p.status === "applied" || p.status === "resolved");
        return (
          <section key={site.id} className="space-y-4" aria-labelledby={`ai-${site.id}`}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id={`ai-${site.id}`} className="text-base font-semibold text-ink">
                {site.name}
              </h2>
              {team && (
                <Link href={`/clients/${id}/settings#site`} className="text-xs font-medium text-accent hover:underline">
                  {site.aiPrompts?.length ? `Question set: ${site.aiPrompts.length} fixed` : "No fixed question set yet: agree one"} · {site.aiSampleEvery === "monthly" ? "monthly" : site.aiSampleEvery === "audit" ? "every audit" : "off"}
                </Link>
              )}
            </div>
            {!latest ? (
              <Card>
                <EmptyState title="No check yet" body="The check runs once a month with the audit; results appear here after the first one." />
              </Card>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Mentioned", now: latest.mentioned, before: first.mentioned, pick: (r: RunCounts) => r.mentioned },
                    { label: "Site cited", now: latest.cited, before: first.cited, pick: (r: RunCounts) => r.cited },
                    { label: "Recommended", now: latest.recommended, before: first.recommended, pick: (r: RunCounts) => r.recommended },
                  ].map((m) => (
                    <Card key={m.label} className="p-4">
                      <div className="text-xs font-medium text-ink-3">{m.label}</div>
                      <div className="mt-1 flex items-end justify-between gap-3">
                        <div>
                          <div className="text-2xl font-semibold leading-none text-ink num">
                            {m.now}
                            <span className="text-sm font-normal text-ink-3"> of {latest.answers}</span>
                          </div>
                          <div className="mt-1 text-xs text-ink-3">
                            {pct(m.now, latest.answers)} of answers{runs.length > 1 ? ` · was ${m.before} of ${first.answers} in ${fmtDay(first.finishedAt)}` : ""}
                          </div>
                        </div>
                        {runs.length > 1 && <Trend runs={runs} pick={m.pick} label={`${m.label} over the last ${runs.length} audits`} />}
                      </div>
                    </Card>
                  ))}
                  <Card className="p-4">
                    <div className="text-xs font-medium text-ink-3">Inaccurate claims</div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div>
                        <div className={`text-2xl font-semibold leading-none num ${latest.inaccuracies ? "text-serious-text" : "text-good-text"}`}>{latest.inaccuracies}</div>
                        <div className="mt-1 text-xs text-ink-3">in the latest check{runs.length > 1 ? ` · was ${first.inaccuracies}` : ""}</div>
                      </div>
                      {runs.length > 1 && (
                        <div className="flex h-10 items-end gap-1" role="img" aria-label={`Inaccurate claims over the last ${runs.length} audits`}>
                          {runs.map((r, i) => {
                            const max = Math.max(1, ...runs.map((x) => x.inaccuracies));
                            return <div key={i} className={`w-4 rounded-sm ${r.inaccuracies ? "bg-serious" : "bg-line-2"}`} style={{ height: `${Math.max(6, (r.inaccuracies / max) * 100)}%` }} title={String(r.inaccuracies)} />;
                          })}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                <Card>
                  <CardHeader title="Question by question" description={`The useful part: which questions name the brand. Each cell: answers that mentioned the brand (cited in brackets), per check, oldest to newest. ${runs.length} check${runs.length === 1 ? "" : "s"} so far.`} />
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-sm">
                      <thead>
                        <tr>
                          <th>Question</th>
                          {runs.map((r) => (
                            <th key={r.runId} className="whitespace-nowrap">
                              <Link href={`/runs/${r.runId}`} className="hover:underline">
                                {fmtDay(r.finishedAt)}
                              </Link>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {prompts.map((p) => (
                          <tr key={p.prompt}>
                            <td>
                              <div className="text-ink">“{p.prompt}”</div>
                              {p.latestIssues.length > 0 && (
                                <ul className="mt-1 list-disc pl-4 text-xs text-serious-text">
                                  {p.latestIssues.slice(0, 3).map((x, i) => (
                                    <li key={i}>{x}</li>
                                  ))}
                                </ul>
                              )}
                            </td>
                            {p.cells.map((c, i) => (
                              <td key={i} className="num">
                                {c ? (
                                  <span className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-medium ${c.mentioned === c.answers ? "tone-good" : c.mentioned ? "tone-accent" : "tone-neutral"}`} title={`${c.mentioned} of ${c.answers} answers mentioned the brand; ${c.cited} cited the site`}>
                                    {c.mentioned}/{c.answers}
                                    {c.cited ? ` (${c.cited})` : ""}
                                  </span>
                                ) : (
                                  <span className="text-xs text-ink-3">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="What assistants get wrong" count={openClaims.length} description="Claims in the latest check that contradict the site. The next audit proposes page text that states the correct fact." />
                    {openClaims.length === 0 ? (
                      <EmptyState title="Nothing contradicted the site" />
                    ) : (
                      <ul className="divide-y divide-line">
                        {openClaims.map((f) => (
                          <li key={f.id} className="px-5 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <SeverityPill severity={f.severity} />
                              <span className="font-medium text-ink">{f.title}</span>
                            </div>
                            {f.detail && <p className="mt-1 text-ink-2">{f.detail}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card>
                    <CardHeader
                      title="Content fixes"
                      count={waiting.length}
                      description={waiting.length ? `${waiting.length} waiting; ${done.length} applied so far` : done.length ? `${done.length} applied; nothing waiting` : "Plain-language page text proposed by the audit for the questions assistants miss"}
                      actions={
                        waiting.length ? (
                          <Link href={`/clients/${id}/fixes`} className={`${btnSecondary} ${btnSm}`}>
                            Review
                          </Link>
                        ) : undefined
                      }
                    />
                    {contentFixes.length === 0 ? (
                      <EmptyState title="No content fixes yet" body="They appear after an audit that found a page not stating its answer plainly, or an assistant getting a fact wrong." />
                    ) : (
                      <ul className="divide-y divide-line">
                        {contentFixes.slice(0, 8).map((p) => (
                          <ProposalRow key={p.id} proposal={p} back={back} compact role={team ? "team" : "client"} />
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
