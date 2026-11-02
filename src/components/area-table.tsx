import type { CategoryKey, CategoryScores, Finding } from "@/db/schema";
import { CATEGORY_LABELS, CLIENT_LABELS, CATEGORY_HINTS, CLIENT_HINTS, SCORED_CATEGORIES } from "@/audit/score";
import { rankFindings } from "./top-issues";

function bar(score: number | null | undefined): string {
  if (score == null) return "bg-line-2";
  return score >= 90 ? "bg-good" : score >= 70 ? "bg-warn" : "bg-critical";
}

// Every area as one row: name, a bar, the change, open count, and one line
// that says what the score means right now. Each row opens its section.
export function AreaTable({ scores, previousScores, findings, audience = "team" }: { scores: CategoryScores | null | undefined; previousScores?: CategoryScores | null; findings: Finding[]; audience?: "team" | "client" }) {
  const LABELS = audience === "client" ? CLIENT_LABELS : CATEGORY_LABELS;
  const HINTS = audience === "client" ? CLIENT_HINTS : CATEGORY_HINTS;
  const rows = SCORED_CATEGORIES.map((cat: CategoryKey) => {
    const list = findings.filter((f) => f.category === cat);
    const top = rankFindings(list)[0];
    const score = scores?.[cat];
    const before = previousScores?.[cat];
    const delta = score != null && before != null ? score - before : null;
    const line = list.length === 0 ? `Nothing found. ${HINTS[cat]}` : list.length === 1 ? top.title : `${top.title}, and ${list.length - 1} more.`;
    return { cat, score, delta, open: list.length, line };
  });
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            <th className="px-5 py-2.5 font-semibold">Area</th>
            <th className="px-3 py-2.5 font-semibold">Score</th>
            <th className="px-3 py-2.5 font-semibold">Change</th>
            <th className="px-3 py-2.5 font-semibold">Open</th>
            <th className="px-5 py-2.5 font-semibold">In one line</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.cat} className="hover:bg-surface-2/50">
              <td className="whitespace-nowrap px-5 py-3 font-semibold text-ink">
                <a href={`#area-${r.cat}`} className="hover:underline">
                  {LABELS[r.cat]}
                </a>
              </td>
              <td className="min-w-40 px-3 py-3">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span className={`block h-full rounded-full ${bar(r.score)}`} style={{ width: `${r.score ?? 0}%` }} />
                  </span>
                  <span className="w-7 text-right font-semibold num">{r.score ?? "–"}</span>
                </div>
              </td>
              <td className={`whitespace-nowrap px-3 py-3 text-xs font-semibold num ${r.delta == null || r.delta === 0 ? "text-ink-3" : r.delta > 0 ? "text-up" : "text-critical-text"}`}>{r.delta == null ? "—" : r.delta === 0 ? "±0" : `${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)}`}</td>
              <td className="px-3 py-3 num">{r.open}</td>
              <td className="px-5 py-3 text-ink-2">{r.line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
