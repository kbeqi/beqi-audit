import type { AiAnswer, Finding, PageMetric, Run, Severity } from "@/db/schema";
import { SEVERITY_ORDER } from "@/audit/score";
import { CategorySections } from "./category-sections";
import { TopIssues } from "./top-issues";
import { Markdown } from "./markdown";
import { AiVisibilityCard, PerformanceCard } from "./insights";
import { Delta, ScoreRing, SeverityPill, fmtDate, hostOf } from "./ui";


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

      <TopIssues findings={findings} baseUrl={baseUrl} readOnly />

      <section aria-labelledby="areas-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="areas-title" className="text-base font-semibold text-ink">
            Every area <span className="text-sm font-normal text-ink-3">({findings.length} findings)</span>
          </h2>
          <div className="flex flex-wrap gap-1.5 text-xs text-ink-3">
            {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <SeverityPill severity={s} /> {counts[s]}
              </span>
            ))}
          </div>
        </div>
        <CategorySections
          scores={run.scores}
          previousScores={previous?.scores}
          findings={findings}
          siteId={run.siteId}
          baseUrl={baseUrl}
          back=""
          readOnly
          aiSummary={run.summary?.aiVisibility}
          extras={{
            ...(metrics.length > 0 || run.summary?.perf ? { performance: <PerformanceCard metrics={metrics} unavailable={run.summary?.perf?.unavailable} embedded /> } : {}),
            ...(run.summary?.aiVisibility ? { ai: <AiVisibilityCard summary={run.summary.aiVisibility} answers={aiAnswers} publicView embedded /> } : {}),
          }}
        />
      </section>

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


      <p className="text-xs text-ink-3">
        Severity: critical and high need attention soon; medium and low are improvements; info is for awareness. Scores are per category and combined into the overall score. &ldquo;Quick win&rdquo; marks fixes that take minutes. AI visibility is a small sample of assistant answers and is not part of the score.
      </p>
    </article>
  );
}

