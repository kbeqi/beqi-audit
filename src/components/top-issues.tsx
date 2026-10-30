import Link from "next/link";
import type { Finding, FixProposal, Severity } from "@/db/schema";
import { CATEGORY_LABELS } from "@/audit/score";
import { EffortPill, SeverityPill } from "./ui";

const SEV: Record<Severity, number> = { critical: 100, high: 60, medium: 30, low: 10, info: 0 };
const EFFORT: Record<string, number> = { quick: 1.3, moderate: 1, large: 0.8 };

// The handful of findings worth doing first: ranked by severity, then by how
// cheap the fix is, then by whether a fix is already proposed. Same idea as
// the "Top issues" table in Ahrefs or Semrush, with effort folded in.
export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings]
    .filter((f) => !f.ignored && f.severity !== "info")
    .map((f) => ({ f, w: SEV[f.severity] * (EFFORT[f.effort ?? "moderate"] ?? 1) + (f.confidence === "low" ? -5 : 0) }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.f);
}

export function TopIssues({ findings, proposals = [], limit = 6, readOnly = false, baseUrl }: { findings: Finding[]; proposals?: FixProposal[]; limit?: number; readOnly?: boolean; baseUrl: string }) {
  const ranked = rankFindings(findings).slice(0, limit);
  if (ranked.length === 0) return null;
  const openProposal = (f: Finding) => proposals.find((p) => p.findingId === f.id && (p.status === "proposed" || p.status === "approved" || p.status === "applying"));
  return (
    <section aria-labelledby="top-issues" className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
        <div>
          <h2 id="top-issues" className="text-sm font-semibold text-ink">
            Fix first
          </h2>
          <p className="text-xs text-ink-3">Ranked by how much each one matters and how quick it is to fix. Everything else is in the areas below.</p>
        </div>
        <a href="#areas" className="text-xs font-medium text-accent hover:underline">
          All findings
        </a>
      </div>
      <ol className="divide-y divide-line">
        {ranked.map((f, i) => {
          const proposal = readOnly ? undefined : openProposal(f);
          const href = `#finding-${f.id}`;
          return (
            <li key={f.id} className="flex flex-wrap items-start gap-3 px-5 py-3 sm:flex-nowrap">
              <span aria-hidden className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-surface num">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityPill severity={f.severity} />
                  <EffortPill effort={f.effort} />
                  <span className="text-xs text-ink-3">
                    {CATEGORY_LABELS[f.category]}
                    {f.pagePath ? ` · ${f.pagePath}` : ""}
                  </span>
                </div>
                <a href={href} className="mt-1 block text-sm font-medium text-ink hover:underline">
                  {f.title}
                </a>
                {f.detail && <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{f.detail}</p>}
              </div>
              {proposal && (
                <Link href={`/fixes/${proposal.id}`} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium tone-accent hover:brightness-95">
                  {proposal.status === "proposed" ? "Review the fix" : proposal.status === "applying" ? "Being applied…" : "Fix approved"}
                </Link>
              )}
              {!proposal && !readOnly && f.pagePath && (
                <a href={safeJoin(baseUrl, f.pagePath)} target="_blank" rel="noreferrer" className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2">
                  Open page
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function safeJoin(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return base;
  }
}
