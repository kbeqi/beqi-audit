"use client";

import { type Ev, LiveLog, useStream } from "./live-log";

// The audit pipeline as the person sees it. Stage boundaries are recognised
// from the status events the runner emits (titles are stable strings).
const STAGES = [
  { key: "metrics", label: "Measuring vitals", weight: 0.05 },
  { key: "agent", label: "Reading the site", weight: 0.68 },
  { key: "structure", label: "Writing the report", weight: 0.08 },
  { key: "ai", label: "AI visibility sample", weight: 0.15 },
  { key: "finish", label: "Scoring", weight: 0.04 },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

function stageOf(events: Ev[], expectedFetches: number): { current: StageKey; doneWithin: number; failed: boolean } {
  let current: StageKey = "metrics";
  let fetches = 0;
  let aiAnswersDone = 0;
  let failed = false;
  for (const e of events) {
    const t = e.title;
    if (e.kind === "error") failed = true;
    if (e.kind === "fetch") fetches++;
    if (t.startsWith("Auditing ")) current = "agent";
    else if (t.startsWith("Structuring the report")) current = "structure";
    else if (t.startsWith("Sampling AI answers")) current = "ai";
    else if (t.startsWith("Checking ") && t.includes("answers")) aiAnswersDone = 1;
    else if (t.startsWith("AI sample:") || t.startsWith("Results emailed") || t.startsWith("Results email")) current = "finish";
  }
  // Progress inside the current stage, 0..1.
  let doneWithin = 0;
  if (current === "agent") doneWithin = Math.min(0.9, fetches / Math.max(8, expectedFetches));
  else if (current === "ai") doneWithin = aiAnswersDone ? 0.85 : 0.4;
  else if (current === "structure") doneWithin = 0.5;
  else if (current === "finish") doneWithin = 0.5;
  return { current, doneWithin, failed };
}

function overall(current: StageKey, doneWithin: number): number {
  let p = 0;
  for (const s of STAGES) {
    if (s.key === current) return p + s.weight * doneWithin;
    p += s.weight;
  }
  return 1;
}

function fmtMin(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m <= 0) return "under a minute";
  if (m === 1) return "about a minute";
  return `about ${m} minutes`;
}

export function RunMonitor({
  streamId,
  initial,
  live,
  startedAt,
  pageBudget,
  recentDurations,
  compact = false,
}: {
  streamId: string;
  initial: Ev[];
  live: boolean;
  startedAt?: string | null;
  pageBudget: number;
  recentDurations: number[];
  compact?: boolean;
}) {
  const stream = useStream(streamId, initial, live, startedAt);
  const { events, polling, elapsedMs } = stream;

  // Expected total: the site's own history when there is some, else a rule
  // of thumb (five minutes plus twelve seconds a page).
  const history = recentDurations.filter((ms) => ms > 60_000).sort((a, b) => a - b);
  const expectedMs = history.length ? history[Math.floor(history.length / 2)] : 5 * 60_000 + pageBudget * 12_000;
  const { current, doneWithin, failed } = stageOf(events, Math.round(pageBudget * 0.8) + 3);
  const progress = polling ? Math.max(0.02, Math.min(0.97, overall(current, doneWithin))) : 1;

  let eta: string | null = null;
  if (polling && elapsedMs !== null) {
    const byTime = expectedMs - elapsedMs;
    const byProgress = progress > 0.15 ? (elapsedMs * (1 - progress)) / progress : byTime;
    const remaining = Math.max(30_000, (byTime + byProgress) / 2);
    eta = elapsedMs > expectedMs * 1.6 ? "taking longer than usual; it stops itself after 25 minutes" : `${fmtMin(remaining)} left`;
  }
  const currentIndex = STAGES.findIndex((s) => s.key === current);

  return (
    <div>
      {polling && (
        <div className="border-b border-line px-5 py-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="text-sm font-medium text-ink">
              {STAGES[currentIndex].label}
              <span className="text-ink-3">
                {" "}
                · step {currentIndex + 1} of {STAGES.length}
              </span>
            </div>
            <div className="text-sm text-ink-2">
              {eta ? <span>{eta[0].toUpperCase() + eta.slice(1)}</span> : "Starting…"}
              {history.length > 0 && <span className="text-xs text-ink-3"> · last audit took {fmtMin(expectedMs).replace("about ", "")}</span>}
            </div>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Audit progress">
            <div className="h-full rounded-full bg-accent-bg transition-[width] duration-1000" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <ol className="mt-2 hidden grid-cols-5 gap-1 text-[11px] leading-tight sm:grid">
            {STAGES.map((s, i) => {
              const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
              return (
                <li key={s.key} className={`flex items-center gap-1 ${state === "todo" ? "text-ink-3" : state === "active" ? "font-medium text-ink" : "text-ink-2"}`} aria-current={state === "active" ? "step" : undefined}>
                  <span aria-hidden className={state === "done" ? "text-good-text" : state === "active" ? "pulse text-accent" : "text-line-2"}>
                    {state === "done" ? "✓" : "●"}
                  </span>
                  <span className="truncate">{s.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {!polling && failed && <div className="border-b border-line px-5 py-2 text-xs text-critical-text">The run stopped with an error; details in the log below.</div>}
      <LiveLog streamId={streamId} initial={initial} live={live} compact={compact} startedAt={startedAt} stream={stream} />
    </div>
  );
}
