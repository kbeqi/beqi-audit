import type { Metadata } from "next";
import Link from "next/link";
import { requireTeam } from "@/app/gate";
import { portfolioHome } from "@/lib/queries";
import { Card, EmptyState, Notice, ScoreRing, StatusPill, btnPrimary, fmtCost, fmtDay, hostOf, timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients" };

const TONE: Record<string, string> = { critical: "text-critical-text", warn: "text-warn-text", accent: "text-accent", neutral: "text-ink-2" };

// The team's home: what needs the team today, one row per client sorted by
// that, and the month in numbers.
export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string }> }) {
  await requireTeam("/");
  const { error, deleted } = await searchParams;
  const { rows, today, month } = await portfolioHome();
  const monthName = new Date().toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Clients</h1>
          <p className="mt-1 text-sm text-ink-2">
            {rows.length === 0 ? "No clients yet." : `${rows.length} site${rows.length === 1 ? "" : "s"} under care. Sorted by what needs you first.`}
          </p>
        </div>
        <Link href="/clients/new" className={btnPrimary}>
          Add client
        </Link>
      </div>
      {error && <Notice tone="critical">{decodeURIComponent(error)}</Notice>}
      {deleted && <Notice tone="good">Deleted “{deleted}” and all of its audit history.</Notice>}

      {rows.length > 0 && (
        <section aria-label="What needs the team today" className="grid gap-4 sm:grid-cols-3">
          <Card className={`p-5 ${today.toApply ? "border-accent/40 bg-accent/5" : ""}`}>
            <div className="text-xs text-ink-3">Approved, for Beqi to apply</div>
            <div className="mt-1 text-3xl font-bold leading-none tracking-tight text-ink num">{today.toApply}</div>
            <div className="mt-1.5 text-sm text-ink-2">
              {today.toApply ? (
                <>
                  {today.toApplyByClient.map((c) => `${c.name} ${c.n}`).join(" · ")}
                  {today.toApplyOldestDays != null && today.toApplyOldestDays >= 1 ? ` · oldest ${today.toApplyOldestDays} day${today.toApplyOldestDays === 1 ? "" : "s"}` : ""}
                </>
              ) : (
                "Nothing waiting on us"
              )}
            </div>
            {today.toApply > 0 && (
              <Link href="/fixes" className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">
                Apply them →
              </Link>
            )}
          </Card>
          <Card className="p-5">
            <div className="text-xs text-ink-3">Waiting on clients</div>
            <div className="mt-1 text-3xl font-bold leading-none tracking-tight text-ink num">{today.waitingOnClients}</div>
            <div className="mt-1.5 text-sm text-ink-2">{today.waitingLongest ? `${today.waitingLongest.name} has had one open for ${today.waitingLongest.days} day${today.waitingLongest.days === 1 ? "" : "s"}${today.waitingLongest.days >= 7 ? "; worth a nudge" : ""}` : "Nothing waiting on a client"}</div>
          </Card>
          <Card className="p-5">
            <div className="text-xs text-ink-3">Needs a person</div>
            <div className={`mt-1 text-3xl font-bold leading-none tracking-tight num ${today.needsPerson.length ? "text-critical-text" : "text-ink"}`}>{today.needsPerson.length}</div>
            <div className="mt-1.5 text-sm text-ink-2">
              {today.needsPerson.length ? (
                today.needsPerson.slice(0, 2).map((n, i) => (
                  <span key={n.name}>
                    {i > 0 ? " · " : ""}
                    <Link href={n.href} className="text-accent hover:underline">
                      {n.name}
                    </Link>
                    : {n.why.toLowerCase()}
                  </span>
                ))
              ) : (
                "Every site connected and audited"
              )}
            </div>
          </Card>
        </section>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No clients yet"
            body="Add a client, then connect their Webflow workspace; their site is imported from it."
            action={
              <Link href="/clients/new" className={btnPrimary}>
                Add your first client
              </Link>
            }
          />
        </Card>
      ) : (
        <section aria-label="Clients" className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                <th className="px-5 py-2.5 font-semibold">Client</th>
                <th className="px-3 py-2.5 font-semibold">Score</th>
                <th className="px-3 py-2.5 font-semibold">30 days</th>
                <th className="px-3 py-2.5 font-semibold">Needs</th>
                <th className="px-3 py-2.5 font-semibold">Last audit</th>
                <th className="px-5 py-2.5 font-semibold">Lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.client.id} className="hover:bg-surface-2/50">
                  <td className="px-5 py-3">
                    <Link href={`/clients/${r.client.id}`} className="font-semibold text-ink hover:underline">
                      {r.client.name}
                    </Link>
                    <div className="text-xs text-ink-3">{r.site ? hostOf(r.site.baseUrl) : "no site yet"}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <ScoreRing score={r.score} size="sm" />
                      <span className="font-semibold num">{r.score ?? "–"}</span>
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-3 text-xs font-semibold num ${r.delta30 == null || r.delta30 === 0 ? "text-ink-3" : r.delta30 > 0 ? "text-up" : "text-critical-text"}`}>{r.delta30 == null ? "—" : r.delta30 === 0 ? "±0" : `${r.delta30 > 0 ? "+" : "−"}${Math.abs(r.delta30)}`}</td>
                  <td className="px-3 py-3">
                    <Link href={r.need.href} className={`font-semibold hover:underline ${TONE[r.need.tone]}`}>
                      {r.need.label}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                    {r.running ? <StatusPill status="running" /> : r.lastAudit ? timeAgo(r.lastAudit) : "never"}
                    <span className="text-ink-3"> · {r.auditsOff ? "manual" : `next ${fmtDay(r.nextRunAt)}`}</span>
                  </td>
                  <td className="px-5 py-3 text-ink-2">{r.lead ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {rows.length > 0 && (
        <section aria-labelledby="month" className="space-y-3">
          <h2 id="month" className="text-lg font-semibold text-ink">
            {monthName} across all clients
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5">
              <div className="text-xs text-ink-3">Fixes applied</div>
              <div className="mt-1 text-2xl font-semibold leading-none text-good-text num">{month.applied}</div>
              <div className="mt-1.5 text-xs text-ink-2">{month.appliedByClients} approved by clients, {month.applied - month.appliedByClients} by Beqi</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-ink-3">Issues resolved</div>
              <div className="mt-1 text-2xl font-semibold leading-none text-ink num">{month.resolved}</div>
              <div className="mt-1.5 text-xs text-ink-2">{month.found} new found in the same month</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-ink-3">Audits run</div>
              <div className="mt-1 text-2xl font-semibold leading-none text-ink num">{month.audits}</div>
              <div className="mt-1.5 text-xs text-ink-2">{fmtCost(month.costUsd)} in model cost</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-ink-3">Monthly reports</div>
              <div className="mt-1 text-2xl font-semibold leading-none text-ink num">
                {month.reportsSent} of {month.clients}
              </div>
              <div className="mt-1.5 text-xs text-ink-2">sent on the 1st by email and Slack</div>
            </Card>
          </div>
        </section>
      )}
    </div>
  );
}
