import Link from "next/link";
import type { CategoryKey, Finding, FixProposal, Severity } from "@/db/schema";
import { CATEGORY_LABELS, CATEGORY_ORDER, SEVERITY_ORDER } from "@/audit/score";
import { ignoreFinding, markFindingState } from "@/app/actions";
import { SubmitButton } from "./submit-button";
import { ConfidencePill, EffortPill, SeverityPill, btnGhost, btnSm } from "./ui";

const sevRank = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, i])) as Record<Severity, number>;

export interface FindingsListProps {
  findings: Finding[];
  siteId: string;
  baseUrl: string;
  back: string;
  proposals?: FixProposal[];
  newFingerprints?: Set<string>;
  severity?: Severity | "all";
  showIgnored?: boolean;
}

export function FindingsList({ findings, siteId, baseUrl, back, proposals = [], newFingerprints, severity = "all", showIgnored = false }: FindingsListProps) {
  const visible = findings.filter((f) => (showIgnored || !f.ignored) && (severity === "all" || f.severity === severity));
  if (visible.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-ink-3">{findings.length ? "Nothing matches this filter." : "No findings."}</p>;
  }
  const byFinding = new Map<string, FixProposal[]>();
  for (const p of proposals) {
    if (!p.findingId) continue;
    if (!byFinding.has(p.findingId)) byFinding.set(p.findingId, []);
    byFinding.get(p.findingId)!.push(p);
  }
  const groups = new Map<CategoryKey, Finding[]>();
  for (const f of visible) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category)!.push(f);
  }
  return (
    <div className="divide-y divide-line">
      {CATEGORY_ORDER.filter((c) => groups.has(c)).map((cat) => {
        const list = groups.get(cat)!.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (a.pagePath ?? "").localeCompare(b.pagePath ?? ""));
        return (
          <section key={cat}>
            <h3 className="bg-surface-2/60 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              {CATEGORY_LABELS[cat]} <span className="num font-medium">({list.length})</span>
            </h3>
            <ul className="divide-y divide-line">
              {list.map((f) => (
                <FindingRow key={f.id} f={f} siteId={siteId} baseUrl={baseUrl} back={back} proposals={byFinding.get(f.id) ?? []} isNew={newFingerprints?.has(f.fingerprint) ?? false} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function FindingRow({ f, siteId, baseUrl, back, proposals, isNew }: { f: Finding; siteId: string; baseUrl: string; back: string; proposals: FixProposal[]; isNew: boolean }) {
  const data = (f.data ?? {}) as { evidence?: string[] };
  const evidence = Array.isArray(data.evidence) ? data.evidence.filter((e) => typeof e === "string" && e.trim()) : [];
  const open = proposals.find((p) => p.status === "proposed" || p.status === "approved" || p.status === "applying");
  const applied = proposals.find((p) => p.status === "applied" || p.status === "resolved");
  return (
    <li className={`px-5 py-3 ${f.ignored ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <SeverityPill severity={f.severity} />
          {isNew && <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide tone-accent">new</span>}
          <EffortPill effort={f.effort} />
          <ConfidencePill confidence={f.confidence} />
        </div>
        <div className="min-w-0 flex-[1_1_16rem]">
          <div className="text-sm font-medium text-ink">{f.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {f.pagePath ? (
              <a href={safeJoin(baseUrl, f.pagePath)} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                {f.pagePath}
              </a>
            ) : (
              <span className="text-ink-3">site-wide</span>
            )}
            <span className="font-mono text-ink-3">{f.checkId}</span>
          </div>
          {f.detail && <p className="mt-1.5 text-sm text-ink-2">{f.detail}</p>}
          {evidence.length > 0 && (
            <details className="mt-1.5 text-xs text-ink-2">
              <summary className="select-none text-ink-3 hover:text-ink">
                Evidence <span className="num">({evidence.length})</span>
              </summary>
              <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto rounded-lg bg-surface-2 px-3 py-2 font-mono">
                {evidence.map((x, i) => (
                  <li key={i} className="break-all">
                    {x}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {(open || applied) && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {open && (
                <Link href={`/fixes/${open.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium tone-accent hover:brightness-95">
                  {open.status === "proposed" ? "Fix proposed — review" : open.status === "applying" ? "Fix being applied…" : "Fix approved"} →
                </Link>
              )}
              {applied && !open && (
                <Link href={`/fixes/${applied.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium tone-good">
                  {applied.status === "resolved" ? "Fixed manually" : `Fix applied${applied.result?.needsPublish ? " · publish to go live" : ""}`} →
                </Link>
              )}
            </div>
          )}
          {f.ignored && <div className="mt-1 text-xs text-ink-3">Suppressed by an ignore rule</div>}
        </div>
        {!f.ignored && (
          <div className="flex shrink-0 gap-1">
            <form action={ignoreFinding}>
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="checkId" value={f.checkId} />
              <input type="hidden" name="pagePath" value={f.pagePath ?? ""} />
              <input type="hidden" name="scope" value={f.pagePath ? "page" : "site"} />
              <input type="hidden" name="back" value={back} />
              <SubmitButton className={`${btnGhost} ${btnSm}`} title="Suppress this check on this page in future audits" pendingLabel="Ignoring…">
                Ignore
              </SubmitButton>
            </form>
            <form action={markFindingState}>
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="fingerprint" value={f.fingerprint} />
              <input type="hidden" name="status" value="false_positive" />
              <input type="hidden" name="back" value={back} />
              <SubmitButton className={`${btnGhost} ${btnSm}`} title="Hide this finding; it stays hidden unless reopened" pendingLabel="Saving…">
                Not an issue
              </SubmitButton>
            </form>
          </div>
        )}
      </div>
    </li>
  );
}

function safeJoin(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return base;
  }
}
