import Link from "next/link";
import type { Finding, FixProposal } from "@/db/schema";
import { CLIENT_LABELS, CATEGORY_LABELS } from "@/audit/score";
import { rankFindings } from "./top-issues";
import { EffortPill, SeverityPill, btnPrimary, btnSecondary } from "./ui";

// "Three things to do first": each with why it matters and what will be
// done, and one action. The plain-language version of TopIssues.
export function FixFirst({ findings, proposals, audience = "team", limit = 3 }: { findings: Finding[]; proposals: FixProposal[]; audience?: "team" | "client"; limit?: number }) {
  const client = audience === "client";
  const LABELS = client ? CLIENT_LABELS : CATEGORY_LABELS;
  const ranked = rankFindings(findings).slice(0, limit);
  if (ranked.length === 0) return null;
  const proposalOf = (f: Finding) => proposals.find((p) => p.findingId === f.id && (p.status === "proposed" || p.status === "client_approved" || p.status === "approved" || p.status === "applying"));
  return (
    <section aria-labelledby="first" className="space-y-3">
      <div>
        <h2 id="first" className="text-lg font-semibold text-ink">
          {ranked.length === 1 ? "The one thing to do first" : ranked.length === 2 ? "Two things to do first" : "Three things to do first"}
        </h2>
        <p className="text-sm text-ink-3">Ranked by how much they matter and how quick they are. Everything else is in the areas below.</p>
      </div>
      <ol className="space-y-3">
        {ranked.map((f, i) => {
          const p = proposalOf(f);
          const data = (f.data ?? {}) as { evidence?: string[] };
          return (
            <li key={f.id} className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-[36px_minmax(0,1fr)_auto]">
              <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-semibold text-surface num">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityPill severity={f.severity} />
                  <EffortPill effort={f.effort} />
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                    {LABELS[f.category]}
                    {f.pagePath ? ` · ${f.pagePath}` : ""}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-ink">
                  <a href={`#finding-${f.id}`} className="hover:underline">
                    {f.title}
                  </a>
                </h3>
                {f.detail && (
                  <p className="text-sm leading-relaxed text-ink-2">
                    <strong className="font-semibold text-ink">Why it matters:</strong> {f.detail}
                  </p>
                )}
                {p ? (
                  <p className="text-sm leading-relaxed text-ink-2">
                    <strong className="font-semibold text-ink">What we&apos;ll do:</strong> {p.title ?? p.rationale}
                    {p.status === "proposed" ? (client ? " You approve it first." : " Waiting for approval.") : p.status === "applying" ? " Being applied now." : " Approved; Beqi applies it next."}
                  </p>
                ) : data.evidence?.length ? (
                  <p className="text-sm leading-relaxed text-ink-2">
                    <strong className="font-semibold text-ink">Seen on:</strong> {data.evidence.slice(0, 2).join(" · ")}
                  </p>
                ) : null}
              </div>
              <div className="sm:pt-1">
                {p && p.status === "proposed" ? (
                  <Link href={`/fixes/${p.id}`} className={`${btnPrimary} whitespace-nowrap`}>
                    {client ? (p.risk === "low" ? "Approve the fix" : "Read the wording") : "Review the fix"}
                  </Link>
                ) : p ? (
                  <span className="inline-flex whitespace-nowrap rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink-2">Beqi handles this</span>
                ) : (
                  <a href={`#finding-${f.id}`} className={`${btnSecondary} whitespace-nowrap`}>
                    See details
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
