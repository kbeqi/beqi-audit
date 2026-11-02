import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeClient, requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { clientDetail, primarySite, siteChanges, type ChangeItem } from "@/lib/queries";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { Card, EmptyState, fmtDay, triggerLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "Changes" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Changes` : "Changes" };
}

const KIND: Record<ChangeItem["kind"], { label: string; dot: string; text: string }> = {
  fixed: { label: "Fixed", dot: "bg-good", text: "text-good-text" },
  new: { label: "New", dot: "bg-warn", text: "text-warn-text" },
  open: { label: "Still open", dot: "bg-line-2", text: "text-ink-2" },
  checked: { label: "Checked", dot: "bg-line-2", text: "text-ink-2" },
};

// What changed on the site, audit by audit. Fixed means the next audit
// confirmed the issue is gone; New means it appeared since the previous check.
export default async function ClientChanges({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch & { show?: string }> }) {
  const { id } = await params;
  const team = isTeam(await requireClientAccess(id, `/clients/${id}/changes`));
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const site = primarySite(data.sites.map((s) => s.site));
  const changes = site ? await siteChanges(site.id) : null;
  const show = (["fixed", "new", "open"] as const).includes(q.show as "fixed") ? (q.show as ChangeItem["kind"]) : "all";
  const base = `/clients/${id}/changes`;
  const m = changes?.month;
  const monthName = new Date().toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-8">
      <ClientNotices q={q} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">What changed on your site</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">Every audit is compared with the one before. Fixed means the next audit confirmed it is gone. New means it appeared since the previous check.</p>
        </div>
        <div role="group" aria-label="Show" className="flex gap-1 rounded-xl border border-line p-0.5 text-sm">
          {(["all", "fixed", "new", "open"] as const).map((k) => (
            <Link key={k} href={k === "all" ? base : `${base}?show=${k}`} aria-current={show === k ? "true" : undefined} className={`rounded-lg px-3 py-1.5 font-medium ${show === k ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}>
              {k === "all" ? "Everything" : k === "open" ? "Still open" : KIND[k].label}
            </Link>
          ))}
        </div>
      </div>

      {!changes || changes.audits.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to compare yet" body="Changes appear once two audits have run." />
        </Card>
      ) : (
        <>
          {m && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-4">
                <div className="text-xs text-ink-3">Fixed in {monthName}</div>
                <div className="mt-1 text-2xl font-semibold leading-none text-good-text num">{m.fixed}</div>
                <div className="mt-1.5 text-xs text-ink-2">{m.fixedByBeqi + m.fixedByClient ? `${m.fixedByBeqi} by Beqi, ${m.fixedByClient} by your team` : "confirmed by the audits"}</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-ink-3">Found in {monthName}</div>
                <div className="mt-1 text-2xl font-semibold leading-none text-ink num">{m.found}</div>
                <div className="mt-1.5 text-xs text-ink-2">new issues the audits picked up</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-ink-3">Score this month</div>
                <div className="mt-1 text-2xl font-semibold leading-none text-ink num">
                  {m.scoreStart ?? "–"} <span aria-hidden className="font-normal text-ink-3">→</span> {m.scoreNow ?? "–"}
                </div>
                <div className="mt-1.5 text-xs text-ink-2">out of 100, start of month to now</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-ink-3">Pages checked every audit</div>
                <div className="mt-1 text-2xl font-semibold leading-none text-ink num">{m.pagesChecked ?? "–"}</div>
                <div className="mt-1.5 text-xs text-ink-2">each one fetched, compared with the audit before</div>
              </Card>
            </div>
          )}

          <section aria-label="Changes by audit" className="space-y-7">
            {changes.audits.map(({ run, previous, items }) => {
              const visible = show === "all" ? items : items.filter((it) => it.kind === show);
              if (visible.length === 0 && show !== "all") return null;
              const delta = run.scoreOverall != null && previous?.scoreOverall != null ? run.scoreOverall - previous.scoreOverall : null;
              return (
                <div key={run.id} className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="pt-0.5">
                    <Link href={`/runs/${run.id}`} className="text-sm font-semibold text-ink hover:underline">
                      {fmtDay(run.finishedAt ?? run.createdAt)}
                    </Link>
                    <div className="text-xs leading-relaxed text-ink-3">
                      {run.trigger === "publish" ? "Checked after a publish" : `${triggerLabel(run.trigger)} audit`}
                      <br />
                      Score {previous?.scoreOverall != null && delta !== 0 ? `${previous.scoreOverall} → ${run.scoreOverall ?? "–"}` : `${run.scoreOverall ?? "–"}${delta === 0 ? ", unchanged" : ""}`}
                    </div>
                  </div>
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                    {visible.length === 0 ? (
                      <li className="px-5 py-3 text-sm text-ink-3">Nothing fixed or found; the site matched the previous audit.</li>
                    ) : (
                      visible.map((it, i) => (
                        <li key={i} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:gap-4">
                          <span className={`inline-flex items-center gap-2 pt-0.5 text-xs font-semibold ${KIND[it.kind].text}`}>
                            <span aria-hidden className={`h-2 w-2 rounded-full ${KIND[it.kind].dot}`} />
                            {KIND[it.kind].label}
                          </span>
                          <div className="min-w-0 text-sm leading-relaxed">
                            <div className="font-medium text-ink">{it.title}</div>
                            {it.detail && <div className="text-ink-2">{it.detail}</div>}
                            {it.pagePath && <div className="font-mono text-xs text-ink-3">{it.pagePath}</div>}
                          </div>
                          <div className="text-xs font-semibold">
                            {it.proposalId && (it.kind === "new" || it.kind === "open") && (
                              <Link href={`/fixes/${it.proposalId}`} className="text-accent hover:underline">
                                {it.kind === "new" ? "Approve →" : "Read it →"}
                              </Link>
                            )}
                            {it.proposalId && it.kind === "fixed" && (
                              <Link href={`/fixes/${it.proposalId}`} className="text-accent hover:underline">
                                See the change →
                              </Link>
                            )}
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              );
            })}
          </section>
          <p className="text-sm text-ink-3">
            {team ? (
              <>
                Every audit, with costs:{" "}
                <Link href={`/clients/${id}/audits`} className="text-accent underline">
                  all audits
                </Link>
                .
              </>
            ) : (
              <>
                Every full report:{" "}
                <Link href={`/clients/${id}/audits`} className="text-accent underline">
                  all audits
                </Link>
                .
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
