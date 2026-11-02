import Link from "next/link";
import type { FixedPageEffect, StatsSummary } from "@/lib/google/sync";
import { syncGoogleNow } from "@/app/actions";
import { SubmitButton } from "./submit-button";
import { Card, CardHeader, EmptyState, btnSecondary, btnSm, fmtDay } from "./ui";

function pct(now: number, before: number): string | null {
  if (!before) return null;
  const d = Math.round(((now - before) / before) * 100);
  return `${d > 0 ? "+" : ""}${d}%`;
}

function Change({ now, before, invert = false, suffix = "" }: { now: number | null; before: number | null; invert?: boolean; suffix?: string }) {
  if (now == null || before == null) return <span className="text-xs text-ink-3">—</span>;
  const d = now - before;
  if (Math.abs(d) < 0.05) return <span className="text-xs text-ink-3">unchanged</span>;
  const good = invert ? d < 0 : d > 0;
  const label = suffix === "%" ? pct(now, before) : `${d > 0 ? "+" : ""}${Math.round(d * 10) / 10}`;
  return <span className={`text-xs font-medium ${good ? "text-up" : "text-critical-text"}`}>{label}{suffix === "%" ? "" : suffix} vs previous 28 days</span>;
}

function Bars({ series, pick, title }: { series: StatsSummary["series"]; pick: (d: StatsSummary["series"][number]) => number; title: string }) {
  const vals = series.map(pick);
  const max = Math.max(1, ...vals);
  return (
    <svg viewBox={`0 0 ${Math.max(1, vals.length) * 4} 28`} width="100%" height="28" preserveAspectRatio="none" role="img" aria-label={title} className="mt-2 text-accent">
      {vals.map((v, i) => (
        <rect key={i} x={i * 4} y={28 - (v / max) * 26 - 1} width="3" height={(v / max) * 26 + 1} fill="currentColor" opacity={0.75} />
      ))}
    </svg>
  );
}

// Search Console and GA4 for the last 28 days against the 28 before, the
// trend per day, the top pages, and before/after for pages with an applied fix.
export function TrafficCard({ summary, fixedPages, siteId, siteName, linked, googleConnected, audience = "team" }: { summary: StatsSummary | null; fixedPages: FixedPageEffect[]; siteId: string; siteName: string; linked: boolean; googleConnected: boolean; audience?: "team" | "client" }) {
  const client = audience === "client";
  if (!linked || !summary) {
    return (
      <Card>
        <CardHeader title="Search & traffic" description="Clicks from Google search, visits, and visits from AI assistants, measured from Search Console and GA4" />
        <EmptyState
          title={client ? "Measurement is being set up" : googleConnected ? "Pick the properties for this site" : "Connect Google to measure results"}
          body={client ? "Once Beqi links this site's Search Console and GA4, this card shows clicks, visits and AI referrals, and what changed after each fix." : googleConnected ? "Choose the Search Console and GA4 property in the Settings tab; the last 120 days are pulled right away." : "Connect the client's Google account in Settings (read-only Search Console and GA4), then pick the properties there."}
        />
      </Card>
    );
  }
  const c = summary.current;
  const p = summary.previous;
  if (!summary.hasData) {
    return (
      <Card>
        <CardHeader
          title="Search & traffic"
          description="Nothing synced yet"
          actions={
            !client ? (
              <form action={syncGoogleNow}>
                <input type="hidden" name="siteId" value={siteId} />
                <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Syncing…">
                  Sync now
                </SubmitButton>
              </form>
            ) : undefined
          }
        />
        <EmptyState title="No data yet" body={client ? "The first numbers appear after tonight's sync." : "The nightly sync pulls the last 120 days; use Sync now to pull them immediately. If it fails, the activity log says why (usually the account has no access to the property)."} />
      </Card>
    );
  }
  const tiles: { label: string; value: string; change: React.ReactNode; hint?: string }[] = [
    { label: "Clicks from Google", value: c.clicks.toLocaleString("en-GB"), change: <Change now={c.clicks} before={p.clicks} suffix="%" />, hint: `${c.impressions.toLocaleString("en-GB")} impressions` },
    { label: "Average position", value: c.position != null ? String(c.position) : "—", change: <Change now={c.position} before={p.position} invert />, hint: "lower is better" },
    { label: "Visits", value: c.sessions.toLocaleString("en-GB"), change: <Change now={c.sessions} before={p.sessions} suffix="%" />, hint: c.keyEvents ? `${c.keyEvents} key events` : undefined },
    { label: "Visits from AI assistants", value: c.aiSessions.toLocaleString("en-GB"), change: <Change now={c.aiSessions} before={p.aiSessions} suffix="%" />, hint: c.aiKeyEvents ? `${c.aiKeyEvents} key events` : "ChatGPT, Perplexity, Claude, Gemini, Copilot…" },
  ];
  return (
    <Card>
      <CardHeader
        title="Search & traffic"
        description={`Last 28 days to ${fmtDay(summary.lastDate)} against the 28 before · from Search Console and GA4`}
        actions={
          !client ? (
            <form action={syncGoogleNow}>
              <input type="hidden" name="siteId" value={siteId} />
              <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Syncing…" title="Pull the last 120 days from Google again">
                Sync now
              </SubmitButton>
            </form>
          ) : undefined
        }
      />
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-surface-2 px-3 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{t.label}</div>
            <div className="mt-0.5 text-xl font-semibold leading-none text-ink num">{t.value}</div>
            <div className="mt-1">{t.change}</div>
            {t.hint && <div className="text-xs text-ink-3">{t.hint}</div>}
          </div>
        ))}
      </div>
      {summary.series.length > 1 && (
        <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-3">Clicks per day</div>
            <Bars series={summary.series} pick={(d) => d.clicks} title={`Clicks per day for ${siteName}`} />
          </div>
          <div>
            <div className="text-xs text-ink-3">Visits per day</div>
            <Bars series={summary.series} pick={(d) => d.sessions} title={`Visits per day for ${siteName}`} />
          </div>
          <div>
            <div className="text-xs text-ink-3">AI-referred visits per day</div>
            <Bars series={summary.series} pick={(d) => d.aiSessions} title={`AI-referred visits per day for ${siteName}`} />
          </div>
        </div>
      )}
      {fixedPages.length > 0 && (
        <div className="border-t border-line">
          <div className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">After the fix</div>
          <ul className="divide-y divide-line">
            {fixedPages.map((f) => (
              <li key={f.proposalId} className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <Link href={`/fixes/${f.proposalId}`} className="font-medium text-ink hover:underline">
                    {f.title}
                  </Link>
                  <div className="text-xs text-ink-3">
                    <span className="font-mono">{f.page}</span> · applied {fmtDay(f.appliedAt)} · {f.daysAfter < 14 ? `${f.daysAfter} days since, too early to tell` : `${f.daysAfter} days since`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  <span>
                    Clicks {f.before.clicks} → <span className="font-medium text-ink">{f.after.clicks}</span>
                  </span>
                  <span>
                    Impressions {f.before.impressions} → <span className="font-medium text-ink">{f.after.impressions}</span>
                  </span>
                  {(f.before.position != null || f.after.position != null) && (
                    <span>
                      Position {f.before.position ?? "—"} → <span className="font-medium text-ink">{f.after.position ?? "—"}</span>
                    </span>
                  )}
                  {(f.before.sessions || f.after.sessions) > 0 && (
                    <span>
                      Visits {f.before.sessions} → <span className="font-medium text-ink">{f.after.sessions}</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="px-5 pb-3 pt-1 text-xs text-ink-3">The 28 days before the fix against the days since (up to 28). Seasonality and other changes move these numbers too; read them as a direction, not proof.</p>
        </div>
      )}
      {summary.topPages.length > 0 && (
        <details className="border-t border-line">
          <summary className="px-5 py-2.5 text-xs font-medium text-ink-3 hover:text-ink">Top pages, last 28 days ({summary.topPages.length})</summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Clicks</th>
                  <th>Impressions</th>
                  <th>Position</th>
                  <th>Visits</th>
                  <th>From AI</th>
                  <th>Key events</th>
                </tr>
              </thead>
              <tbody>
                {summary.topPages.map((pg) => (
                  <tr key={pg.page}>
                    <td className="font-mono text-xs">{pg.page}</td>
                    <td className="num">{pg.clicks}</td>
                    <td className="num text-ink-2">{pg.impressions}</td>
                    <td className="num text-ink-2">{pg.position ?? "—"}</td>
                    <td className="num">{pg.sessions}</td>
                    <td className="num text-ink-2">{pg.aiSessions}</td>
                    <td className="num text-ink-2">{pg.keyEvents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}
