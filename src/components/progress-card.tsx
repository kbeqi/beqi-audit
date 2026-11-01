import Link from "next/link";
import type { ClientProgress } from "@/lib/progress";
import { Card, CardHeader, Delta, Sparkline } from "./ui";

// "Is it getting better?" in one card: score trend per site, what was fixed
// and resolved in the period, what is waiting. Shared by the team and the
// client; only the wording of the waiting line differs.
export interface TrafficDelta {
  clicks: number;
  clicksBefore: number;
  sessions: number;
  sessionsBefore: number;
  aiSessions: number;
  aiSessionsBefore: number;
}

function pctHint(now: number, before: number): string | undefined {
  if (!before) return undefined;
  const d = Math.round(((now - before) / before) * 100);
  return `${d > 0 ? "+" : ""}${d}% vs previous 28 days`;
}

export function ProgressCard({ progress, clientId, label, audience = "team", traffic = null }: { progress: ClientProgress; clientId: string; label: string; audience?: "team" | "client"; traffic?: TrafficDelta | null }) {
  const scored = progress.sites.filter((s) => s.score != null);
  if (scored.length === 0) return null;
  const ai = progress.sites.find((s) => s.aiMentioned)?.aiMentioned ?? null;
  const vitals = progress.sites.reduce(
    (acc, s) => (s.vitalsPassing ? { passing: acc.passing + s.vitalsPassing.passing, pages: acc.pages + s.vitalsPassing.pages } : acc),
    { passing: 0, pages: 0 },
  );
  const stats: { label: string; value: string; hint?: string; tone?: "good" | "warn" }[] = [
    { label: "Audits run", value: String(progress.audits) },
    { label: "Issues resolved", value: String(progress.resolved), hint: progress.newIssues ? `${progress.newIssues} new found` : undefined, tone: progress.resolved > 0 ? "good" : undefined },
    { label: "Fixes applied", value: String(progress.fixesApplied), tone: progress.fixesApplied > 0 ? "good" : undefined },
    { label: audience === "client" ? "Waiting for you" : "Waiting for approval", value: String(progress.waiting), tone: progress.waiting > 0 ? "warn" : undefined },
  ];
  if (vitals.pages > 0) stats.push({ label: "Core Web Vitals", value: `${vitals.passing}/${vitals.pages}`, hint: "key pages passing" });
  if (ai) stats.push({ label: "AI answers naming you", value: `${ai.now}/${ai.of}`, hint: ai.before != null && ai.ofBefore ? `was ${ai.before}/${ai.ofBefore}` : "monthly check" });
  if (traffic) {
    stats.push({ label: "Clicks from Google", value: traffic.clicks.toLocaleString("en-GB"), hint: pctHint(traffic.clicks, traffic.clicksBefore) ?? "last 28 days", tone: traffic.clicksBefore && traffic.clicks > traffic.clicksBefore ? "good" : undefined });
    stats.push({ label: "Visits", value: traffic.sessions.toLocaleString("en-GB"), hint: pctHint(traffic.sessions, traffic.sessionsBefore) ?? "last 28 days" });
    stats.push({ label: "Visits from AI", value: traffic.aiSessions.toLocaleString("en-GB"), hint: pctHint(traffic.aiSessions, traffic.aiSessionsBefore) ?? "last 28 days", tone: traffic.aiSessionsBefore && traffic.aiSessions > traffic.aiSessionsBefore ? "good" : undefined });
  }

  return (
    <Card>
      <CardHeader
        title="Progress"
        description={label}
        actions={
          progress.waiting > 0 ? (
            <Link href={`/clients/${clientId}/fixes`} className="text-xs font-medium text-accent hover:underline">
              {audience === "client" ? `Approve ${progress.waiting} fix${progress.waiting === 1 ? "" : "es"}` : `Review ${progress.waiting} fix${progress.waiting === 1 ? "" : "es"}`}
            </Link>
          ) : undefined
        }
      />
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ul className="space-y-3">
          {scored.map((s) => (
            <li key={s.siteId} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link href={`/sites/${s.siteId}`} className="text-sm font-medium text-ink hover:underline">
                  {s.name}
                </Link>
                <div className="text-xs text-ink-3">
                  {s.openFindings != null ? `${s.openFindings} open issue${s.openFindings === 1 ? "" : "s"}` : ""}
                  {s.openBefore != null && s.openFindings != null && s.openBefore !== s.openFindings ? ` (was ${s.openBefore})` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Sparkline values={s.history.slice(-12)} width={120} height={30} title={`Score trend for ${s.name}`} />
                <div className="text-right">
                  <div className="text-lg font-semibold leading-none text-ink num">{s.score}</div>
                  <Delta now={s.score} before={s.scoreBefore} />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((st) => (
            <div key={st.label} className="rounded-lg bg-surface-2 px-3 py-2.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{st.label}</dt>
              <dd className={`mt-0.5 text-xl font-semibold leading-none num ${st.tone === "good" ? "text-good-text" : st.tone === "warn" ? "text-warn-text" : "text-ink"}`}>{st.value}</dd>
              {st.hint && <dd className="mt-1 text-xs text-ink-3">{st.hint}</dd>}
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}
