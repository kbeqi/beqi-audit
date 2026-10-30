import type { AiVisibilitySummary, CategoryKey, CategoryScores, Finding, FixProposal, Severity } from "@/db/schema";
import { CATEGORY_HINTS, CATEGORY_LABELS, SCORED_CATEGORIES } from "@/audit/score";
import { FindingsList } from "./findings";
import { CategoryStrip, type StripItem } from "./category-strip";
import { Delta, ScoreRing } from "./ui";

// The report body: a sticky strip of area gauges that link to the sections,
// then one section per area with its findings always visible. Only a
// finding's evidence is behind a click. `extras` lets a page put a
// measurement card (vitals, AI answers) inside the matching area.
export function CategorySections({
  scores,
  previousScores,
  findings,
  siteId,
  baseUrl,
  back,
  proposals = [],
  newFingerprints,
  severity = "all",
  showIgnored = false,
  readOnly = false,
  aiSummary,
  extras,
}: {
  scores: CategoryScores | null | undefined;
  previousScores?: CategoryScores | null;
  findings: Finding[];
  siteId: string;
  baseUrl: string;
  back: string;
  proposals?: FixProposal[];
  newFingerprints?: Set<string>;
  severity?: Severity | "all";
  showIgnored?: boolean;
  readOnly?: boolean;
  aiSummary?: AiVisibilitySummary | null;
  extras?: Partial<Record<CategoryKey, React.ReactNode>>;
}) {
  const hasAi = findings.some((f) => f.category === "ai") || !!extras?.ai;
  const cats: CategoryKey[] = hasAi ? [...SCORED_CATEGORIES, "ai"] : [...SCORED_CATEGORIES];
  const listFor = (cat: CategoryKey) => findings.filter((f) => f.category === cat && (showIgnored || !f.ignored) && (severity === "all" || f.severity === severity));
  const strip: StripItem[] = cats.map((cat) => ({
    cat,
    label: CATEGORY_LABELS[cat],
    score: cat === "ai" ? undefined : scores?.[cat],
    count: listFor(cat).length,
    note: cat === "ai" ? (aiSummary && aiSummary.answers > 0 ? `${aiSummary.mentioned}/${aiSummary.answers}` : "sampled") : undefined,
  }));
  return (
    <div id="areas" className="space-y-6">
      <CategoryStrip items={strip} />
      {cats.map((cat) => {
        const list = listFor(cat);
        const score = cat === "ai" ? undefined : scores?.[cat];
        return (
          <section key={cat} id={`area-${cat}`} aria-labelledby={`area-${cat}-title`} className="scroll-mt-16 rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-4 border-b border-line px-5 py-3.5">
              {cat === "ai" ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink-2">AI</div>
              ) : (
                <ScoreRing score={score} size="md" label={`${CATEGORY_LABELS[cat]} score ${score ?? "not yet"}`} />
              )}
              <div className="min-w-0 flex-1">
                <h2 id={`area-${cat}-title`} className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink">
                  {CATEGORY_LABELS[cat]}
                  <span className="text-xs font-medium text-ink-3">{list.length === 0 ? "nothing found" : `${list.length} finding${list.length === 1 ? "" : "s"}`}</span>
                  {cat !== "ai" && previousScores && <Delta now={score} before={previousScores[cat]} />}
                </h2>
                <p className="text-xs text-ink-3">
                  {CATEGORY_HINTS[cat]}
                  {cat === "ai" && aiSummary && aiSummary.answers > 0 ? ` · mentioned in ${aiSummary.mentioned} of ${aiSummary.answers} sampled answers, cited in ${aiSummary.cited}` : ""}
                </p>
              </div>
            </div>
            {extras?.[cat] && <div className="border-b border-line">{extras[cat]}</div>}
            {list.length === 0 ? (
              <p className="px-5 py-3 text-sm text-ink-3">{cat === "conversion" && score === undefined ? "New area: scored from the next audit." : "No issues found in this area."}</p>
            ) : (
              <FindingsList findings={list} category={cat} siteId={siteId} baseUrl={baseUrl} back={back} proposals={proposals} newFingerprints={newFingerprints} showIgnored={showIgnored} readOnly={readOnly} />
            )}
          </section>
        );
      })}
    </div>
  );
}
