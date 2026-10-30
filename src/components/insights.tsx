// Measured performance (PageSpeed Insights) and the AI visibility sample, as
// cards. Both are server components fed from D1 rows; the public report reuses
// them with `publicView` so nothing internal shows.

import type { AiAnswer, AiVisibilitySummary, PageMetric } from "@/db/schema";
import { fmtCls, fmtMs, vitalTone, type VitalTone } from "@/audit/psi";
import { engineLabel } from "@/agent/ai-visibility";
import { Card, CardHeader, EmptyState } from "./ui";

const TONE_CLASS: Record<VitalTone, string> = { good: "tone-good", warning: "tone-warn", serious: "tone-serious" };
const TONE_LABEL: Record<VitalTone, string> = { good: "good", warning: "needs work", serious: "poor" };

function Vital({ label, value, tone, source }: { label: string; value: string; tone: VitalTone | null; source?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-ink-3">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span className="num text-base font-semibold text-ink">{value}</span>
        {tone && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_CLASS[tone]}`}>{TONE_LABEL[tone]}</span>}
      </div>
      {source && <div className="text-[11px] text-ink-3">{source}</div>}
    </div>
  );
}

export function PerformanceCard({ metrics, title = "Core Web Vitals", unavailable, embedded = false }: { metrics: PageMetric[]; title?: string; unavailable?: boolean; embedded?: boolean }) {
  const rows = metrics.filter((m) => m.strategy === "mobile");
  const Wrap = embedded ? "div" : Card;
  return (
    <Wrap>
      <CardHeader
        title={title}
        description="Measured by Google PageSpeed Insights on mobile. Real-visitor data (last 28 days) when the page has enough traffic, otherwise one lab run. Good: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1."
      />
      {rows.length === 0 ? (
        <EmptyState title={unavailable ? "PageSpeed could not measure this site" : "No measurements yet"} body={unavailable ? "Google's PageSpeed service failed or timed out for every key page in this audit. The next audit tries again." : "Measurements are taken for the key pages during each audit."} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((m) => {
            const raw = (m.raw ?? {}) as { hasField?: boolean };
            const field = raw.hasField === true;
            const lcp = field ? (m.fieldLcpMs ?? m.lcpMs) : m.lcpMs;
            const cls = field ? (m.fieldCls ?? m.cls) : m.cls;
            const inp = m.fieldInpMs;
            return (
              <li key={m.id} className="grid gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-ink">{m.pagePath}</div>
                  <div className="text-[11px] text-ink-3">{field ? "real visitors · p75" : "lab run"}</div>
                </div>
                <Vital label="Performance" value={m.performanceScore === null ? "n/a" : String(m.performanceScore)} tone={m.performanceScore === null ? null : m.performanceScore >= 90 ? "good" : m.performanceScore >= 50 ? "warning" : "serious"} />
                <Vital label="LCP" value={fmtMs(lcp)} tone={vitalTone("lcpMs", lcp)} />
                <Vital label="INP" value={fmtMs(inp)} tone={vitalTone("inpMs", inp)} source={inp === null ? "field only" : undefined} />
                <Vital label="CLS" value={fmtCls(cls)} tone={vitalTone("cls", cls)} />
              </li>
            );
          })}
        </ul>
      )}
    </Wrap>
  );
}

export function AiVisibilityCard({ summary, answers, publicView = false, embedded = false }: { summary: AiVisibilitySummary | null | undefined; answers: AiAnswer[]; publicView?: boolean; embedded?: boolean }) {
  const Wrap = embedded ? "div" : Card;
  const engines = summary ? Object.keys(summary.byEngine) : [];
  const byPrompt = new Map<string, AiAnswer[]>();
  for (const a of answers) {
    if (!byPrompt.has(a.prompt)) byPrompt.set(a.prompt, []);
    byPrompt.get(a.prompt)!.push(a);
  }
  const pct = (n: number) => (summary && summary.answers ? `${Math.round((n / summary.answers) * 100)}%` : "–");
  return (
    <Wrap>
      <CardHeader
        title="AI visibility (sampled)"
        description={summary?.note ?? "During each audit, AI assistants are asked the questions a prospective customer would ask, and the answers are checked for the brand."}
      />
      {!summary || summary.answers === 0 ? (
        <EmptyState title="No sample yet" body={summary?.note ?? "Runs with the next audit."} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
            <Stat label="Mentioned" value={pct(summary.mentioned)} hint={`${summary.mentioned} of ${summary.answers} answers`} />
            <Stat label="Site cited" value={pct(summary.cited)} hint={`${summary.cited} answers linked to the site`} />
            <Stat label="Recommended" value={pct(summary.recommended)} hint={`${summary.recommended} answers suggested the brand`} />
            <Stat label="Inaccurate claims" value={String(summary.inaccuracies)} hint={summary.inaccuracies ? "listed under findings" : "nothing contradicted the site"} tone={summary.inaccuracies ? "serious" : "good"} />
          </div>
          {engines.length > 1 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-5 py-2.5 text-xs text-ink-3">
              {engines.map((e) => {
                const b = summary.byEngine[e];
                return (
                  <span key={e}>
                    <span className="font-medium text-ink-2">{engineLabel(e)}</span>: mentioned {b.mentioned}/{b.answers}, cited {b.cited}
                  </span>
                );
              })}
            </div>
          )}
          {byPrompt.size > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-2.5 text-xs font-medium text-ink-3 hover:text-ink">
                The {byPrompt.size} questions asked {publicView ? "" : "and what the assistants said"}
              </summary>
              <ul className="divide-y divide-line border-t border-line">
                {[...byPrompt.entries()].map(([prompt, list]) => (
                  <li key={prompt} className="px-5 py-3">
                    <div className="text-sm font-medium text-ink">“{prompt}”</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                      {list.map((a) => (
                        <span key={a.id} className={`rounded-md px-1.5 py-0.5 font-medium ${a.cited ? "tone-good" : a.mentioned ? "tone-accent" : "tone-neutral"}`} title={a.cited ? "Brand mentioned and site cited" : a.mentioned ? "Brand mentioned, site not cited" : "Brand not mentioned"}>
                          {engineLabel(a.engine)} #{a.iteration}: {a.cited ? "cited" : a.mentioned ? "mentioned" : "absent"}
                          {a.issues.length ? ` · ${a.issues.length} issue${a.issues.length > 1 ? "s" : ""}` : ""}
                        </span>
                      ))}
                    </div>
                    {!publicView && (
                      <details className="mt-1.5 text-xs text-ink-2">
                        <summary className="cursor-pointer select-none text-ink-3 hover:text-ink">Read the answers</summary>
                        <ul className="mt-1 space-y-2">
                          {list.map((a) => (
                            <li key={a.id} className="rounded-lg bg-surface-2 px-3 py-2">
                              <div className="mb-1 font-medium text-ink-3">
                                {engineLabel(a.engine)} · answer {a.iteration}
                                {a.citations.length ? ` · cites ${a.citations.slice(0, 3).map(hostOnly).join(", ")}${a.citations.length > 3 ? ` +${a.citations.length - 3}` : ""}` : ""}
                              </div>
                              <p className="whitespace-pre-wrap break-words">{a.answer.length > 1200 ? `${a.answer.slice(0, 1200)}…` : a.answer}</p>
                              {a.issues.length > 0 && (
                                <ul className="mt-1.5 list-disc pl-4 text-serious-text">
                                  {a.issues.map((x, i) => (
                                    <li key={i}>{x}</li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Wrap>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "serious" }) {
  return (
    <div>
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold leading-none ${tone === "serious" ? "text-serious-text" : tone === "good" ? "text-good-text" : "text-ink"}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

function hostOnly(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u;
  }
}
