import type { AiAnswer, CategoryKey, Finding, PageMetric, Run, Severity } from "@/db/schema";
import { CATEGORY_HINTS, CATEGORY_LABELS, CATEGORY_ORDER, SCORED_CATEGORIES, SEVERITY_ORDER } from "@/audit/score";
import { Markdown } from "./markdown";
import { AiVisibilityCard, PerformanceCard } from "./insights";
import { Delta, EffortPill, ScoreRing, SeverityPill, fmtDate, hostOf, scoreTone } from "./ui";

const sevRank = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, i])) as Record<Severity, number>;

// The audit report as a client sees it: no actions, no internal ids, no cost.
export function Report({
  run,
  siteName,
  baseUrl,
  clientName,
  previous,
  findings,
  fixesDone,
  metrics = [],
  aiAnswers = [],
}: {
  run: Run;
  siteName: string;
  baseUrl: string;
  clientName: string | null;
  previous: { scoreOverall: number | null; scores: Run["scores"]; finishedAt: string | null } | null;
  findings: Finding[];
  fixesDone: { title: string | null; status: string; appliedAt: string | null }[];
  metrics?: PageMetric[];
  aiAnswers?: AiAnswer[];
}) {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const groups = new Map<CategoryKey, Finding[]>();
  for (const f of findings) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category)!.push(f);
  }

  return (
    <article className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-3">Website audit{clientName ? ` · ${clientName}` : ""}</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">{siteName}</h1>
          <a href={baseUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
            {hostOf(baseUrl)}
          </a>
          <div className="mt-2 text-sm text-ink-3">
            Audited {fmtDate(run.finishedAt)} · {run.summary?.pagesReviewed ?? 0} of {run.summary?.pagesTotal ?? 0} pages reviewed
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4">
          <ScoreRing score={run.scoreOverall} size="xl" />
          <div className="text-sm">
            <div className="font-medium text-ink">Overall score</div>
            <div className="text-ink-3">out of 100</div>
            {previous && (
              <div className="mt-1">
                <Delta now={run.scoreOverall} before={previous.scoreOverall} /> <span className="text-xs text-ink-3">since {fmtDate(previous.finishedAt).replace(" UTC", "")}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SCORED_CATEGORIES.map((cat) => {
          const score = run.scores?.[cat];
          const tone = scoreTone(score);
          return (
            <div key={cat} className="rounded-xl border border-line bg-surface px-4 py-3">
              <div className="text-xs font-medium text-ink">{CATEGORY_LABELS[cat]}</div>
              <div className="text-[11px] text-ink-3">{CATEGORY_HINTS[cat]}</div>
              <div className="mt-2 flex items-end justify-between">
                <div className={`text-2xl font-semibold leading-none ${tone === "critical" ? "text-critical-text" : "text-ink"}`}>{score ?? "–"}</div>
                {previous && <Delta now={score} before={previous.scores?.[cat]} />}
              </div>
            </div>
          );
        })}
      </section>

      {run.agentSummary && (
        <section className="grid gap-6 rounded-xl border border-line bg-surface p-6 lg:grid-cols-[1fr_18rem]">
          <div>
            <h2 className="mb-3 text-base font-semibold text-ink">Summary</h2>
            <Markdown text={run.agentSummary} />
          </div>
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
        </section>
      )}

      {(metrics.length > 0 || run.summary?.perf) && <PerformanceCard metrics={metrics} unavailable={run.summary?.perf?.unavailable} />}
      {run.summary?.aiVisibility && <AiVisibilityCard summary={run.summary.aiVisibility} answers={aiAnswers} publicView />}

      {fixesDone.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="text-base font-semibold text-ink">Fixed since this audit</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
            {fixesDone.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-good-text">
                  ✓
                </span>
                <span>
                  {f.title ?? "Fix"} <span className="text-xs text-ink-3">· {fmtDate(f.appliedAt).replace(" UTC", "")}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">
            Findings <span className="text-sm font-normal text-ink-3">({findings.length})</span>
          </h2>
          <div className="flex flex-wrap gap-1.5 text-xs text-ink-3">
            {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <SeverityPill severity={s} /> {counts[s]}
              </span>
            ))}
          </div>
        </div>
        {findings.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-6 text-sm text-ink-2">No open findings. Everything checked is in good shape.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {CATEGORY_ORDER.filter((c) => groups.has(c)).map((cat) => {
              const list = groups.get(cat)!.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (a.pagePath ?? "").localeCompare(b.pagePath ?? ""));
              return (
                <div key={cat}>
                  <h3 className="flex flex-wrap items-baseline gap-x-2 bg-surface-2/60 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    {CATEGORY_LABELS[cat]} ({list.length})
                    <span className="font-normal normal-case tracking-normal text-ink-3">{CATEGORY_HINTS[cat]}</span>
                  </h3>
                  <ul className="divide-y divide-line">
                    {list.map((f) => {
                      const evidence = Array.isArray((f.data as { evidence?: unknown })?.evidence) ? ((f.data as { evidence: unknown[] }).evidence.filter((e) => typeof e === "string") as string[]) : [];
                      return (
                        <li key={f.id} className="px-5 py-3">
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="flex items-center gap-1.5 pt-0.5">
                              <SeverityPill severity={f.severity} />
                              <EffortPill effort={f.effort} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-ink">{f.title}</div>
                              <div className="mt-0.5 text-xs">
                                {f.pagePath ? (
                                  <a href={safeJoin(baseUrl, f.pagePath)} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                                    {f.pagePath}
                                  </a>
                                ) : (
                                  <span className="text-ink-3">site-wide</span>
                                )}
                              </div>
                              {f.detail && <p className="mt-1.5 text-sm text-ink-2">{f.detail}</p>}
                              {evidence.length > 0 && (
                                <details className="mt-1.5 text-xs text-ink-2">
                                  <summary className="select-none text-ink-3 hover:text-ink">Details ({evidence.length})</summary>
                                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto rounded-lg bg-surface-2 px-3 py-2 font-mono">
                                    {evidence.map((x, i) => (
                                      <li key={i} className="break-all">
                                        {x}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-ink-3">
        Severity: critical and high need attention soon; medium and low are improvements; info is for awareness. Scores are per category and combined into the overall score. &ldquo;Quick win&rdquo; marks fixes that take minutes. AI visibility is a small sample of assistant answers and is not part of the score.
      </p>
    </article>
  );
}

function safeJoin(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return base;
  }
}
