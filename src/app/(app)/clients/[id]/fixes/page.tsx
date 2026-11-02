import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeClient, requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { clientDetail, fixSteps, primarySite } from "@/lib/queries";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { ACTION_NOTES, ChangeDiff, DecisionButtons, ProposalRow, actionLabel } from "@/components/proposals";
import type { FixAction } from "@/agent/catalog";
import { Card, CardHeader, EffortPill, EmptyState, RiskPill, fmtDay } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "Fixes" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Fixes` : "Fixes" };
}

// Each approval is one read: what changes, now versus after, how it goes
// live, and the buttons. Below, where every fix stands.
export default async function ClientFixes({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch> }) {
  const { id } = await params;
  const team = isTeam(await requireClientAccess(id, `/clients/${id}/fixes`));
  const role = team ? "team" : "client";
  const q = await searchParams;
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, proposals, pendingFixes } = data;
  const site = primarySite(sites.map((s) => s.site));
  const steps = site ? await fixSteps(site.id, 12) : [];
  const waiting = team ? pendingFixes : pendingFixes.filter((p) => p.status === "proposed");
  const back = `/clients/${client.id}/fixes`;
  const effortRank = { quick: 0, moderate: 1, large: 2 } as const;
  const riskRank = { low: 0, medium: 1, high: 2 } as const;
  const sorted = [...waiting].sort((a, b) => effortRank[a.effort ?? "moderate"] - effortRank[b.effort ?? "moderate"] || riskRank[a.risk ?? "medium"] - riskRank[b.risk ?? "medium"] || (a.createdAt < b.createdAt ? 1 : -1));
  const history = proposals.filter((p) => !waiting.includes(p) && (p.status === "rejected" || p.status === "failed"));
  const heading = waiting.length === 0 ? (team ? "Nothing to review" : "Nothing needs your OK") : waiting.length === 1 ? (team ? "One fix to review" : "One change needs your OK") : team ? `${waiting.length} fixes to review` : `${waiting.length === 2 ? "Two" : waiting.length} changes need your OK`;

  return (
    <div className="space-y-8">
      <ClientNotices q={q} />
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{heading}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          {team ? "Nothing is written to Webflow until someone approves it. Low-risk changes a client can apply themselves; the rest come to you as \"approved by client\"." : "Nothing is changed on your site until you approve it. Small, safe changes go live straight away; anything bigger is applied by Beqi after you say yes, and the next audit confirms it."}
        </p>
      </div>

      {sorted.length > 0 && (
        <section aria-label={team ? "To review" : "Waiting for you"} className="space-y-4">
          {sorted.map((p, i) => {
            const changes = p.proposal?.changes ?? [];
            const visible = p.action === "content_text" || p.action === "heading_level" || p.action === "remove_script" || p.action === "image_compress";
            return (
              <article key={p.id} className={`grid gap-6 rounded-xl border p-6 lg:grid-cols-[minmax(0,1fr)_240px] ${i === 0 ? "border-accent/40 bg-accent/5" : "border-line bg-surface"}`}>
                <div className="min-w-0 space-y-3.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    {p.risk === "low" && p.effort === "quick" ? <span className="rounded-md px-2 py-0.5 tone-accent">Quick · safe</span> : visible ? <span className="rounded-md px-2 py-0.5 tone-warn">Changes visible text</span> : <RiskPill risk={p.risk} />}
                    {!(p.risk === "low" && p.effort === "quick") && <EffortPill effort={p.effort} />}
                    <span className="rounded-md bg-surface-2 px-2 py-0.5 text-ink-2">
                      {actionLabel(p.action)}
                      {p.target?.pagePath ? ` · ${p.target.pagePath}` : ""}
                    </span>
                    <span className="rounded-md bg-surface-2 px-2 py-0.5 text-ink-2">Proposed {fmtDay(p.createdAt)}</span>
                  </div>
                  <h2 className="text-lg font-semibold leading-snug text-ink">
                    <Link href={`/fixes/${p.id}`} className="hover:underline">
                      {p.title ?? actionLabel(p.action)}
                    </Link>
                  </h2>
                  {p.rationale && <p className="text-sm leading-relaxed text-ink-2">{p.rationale}</p>}
                  {changes.length > 0 && <ChangeDiff changes={changes.slice(0, 3)} />}
                  {changes.length > 3 && (
                    <Link href={`/fixes/${p.id}`} className="text-xs font-medium text-accent hover:underline">
                      +{changes.length - 3} more changes
                    </Link>
                  )}
                  <p className="text-xs text-ink-3">{ACTION_NOTES[p.action as FixAction] ?? "Applied after approval."} {role === "client" && !(p.risk === "low" && p.action !== "image_compress") ? "Applied by Beqi after your OK." : ""}</p>
                  {p.error && <p className="text-xs text-critical-text">{p.error}</p>}
                </div>
                <div className="flex flex-col justify-center gap-2 [&_form]:w-full [&_button]:w-full [&_button]:justify-center [&_button]:!py-2.5 [&_button]:!text-[15px]">
                  <DecisionButtons proposal={p} back={back} role={role} />
                  {client.leadEmail && role === "client" && (
                    <a href={`mailto:${client.leadEmail}?subject=${encodeURIComponent(`Question about: ${p.title ?? actionLabel(p.action)}`)}`} className="inline-flex w-full items-center justify-center rounded-lg border border-line-2 bg-surface px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-surface-2">
                      Ask Beqi a question
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {sorted.length === 0 && (
        <Card>
          <EmptyState title={team ? "Nothing to review" : "Nothing waiting for you"} body="New proposals appear here after each audit." />
        </Card>
      )}

      {steps.length > 0 && (
        <section aria-labelledby="stand" className="space-y-3">
          <h2 id="stand" className="text-lg font-semibold text-ink">
            Where every fix stands
          </h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-2.5 font-semibold">Fix</th>
                  <th className="px-3 py-2.5 font-semibold">Proposed</th>
                  <th className="px-3 py-2.5 font-semibold">Approved</th>
                  <th className="px-3 py-2.5 font-semibold">Applied</th>
                  <th className="px-3 py-2.5 font-semibold">Confirmed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {steps.map(({ proposal: p, confirmedAt }) => {
                  const ok = (t: string) => <span className="font-semibold text-good-text">✓ {t}</span>;
                  const approved = p.status === "rejected" ? <span className="text-ink-3">Declined</span> : p.approvedBy ? ok(fmtDay(p.createdAt < (p.appliedAt ?? "") ? (p.appliedAt ?? p.createdAt) : p.createdAt)) : p.status === "proposed" ? <span className="font-semibold text-warn-text">Waiting</span> : <span className="text-ink-3">—</span>;
                  const applied = p.status === "applied" || p.status === "resolved" ? ok(p.appliedAt ? fmtDay(p.appliedAt) : "done") : p.status === "applying" ? <span className="font-semibold text-accent">Applying…</span> : p.status === "failed" ? <span className="font-semibold text-critical-text">Failed</span> : p.status === "client_approved" || p.status === "approved" ? <span className="font-semibold text-warn-text">Beqi next</span> : <span className="text-ink-3">—</span>;
                  const confirmed = confirmedAt ? ok(fmtDay(confirmedAt)) : p.status === "applied" || p.status === "resolved" ? <span className="text-ink-3">next audit</span> : <span className="text-ink-3">—</span>;
                  return (
                    <tr key={p.id}>
                      <td className="px-5 py-3">
                        <Link href={`/fixes/${p.id}`} className="font-medium text-ink hover:underline">
                          {p.title ?? actionLabel(p.action)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">{ok(fmtDay(p.createdAt))}</td>
                      <td className="whitespace-nowrap px-3 py-3">{approved}</td>
                      <td className="whitespace-nowrap px-3 py-3">{applied}</td>
                      <td className="whitespace-nowrap px-3 py-3">{confirmed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-3">Confirmed means the following audit checked the page and the issue was gone. If it comes back, it reopens here.</p>
        </section>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader title={team ? "Rejected or failed" : "Declined"} count={history.length} />
          <ul className="divide-y divide-line">
            {history.slice(0, 10).map((p) => (
              <ProposalRow key={p.id} proposal={p} back={back} compact role={role} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
