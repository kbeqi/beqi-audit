import type { AiVisibilitySummary, CategoryKey, CategoryScores, Finding, FixProposal, Severity } from "@/db/schema";
import { CATEGORY_HINTS, CATEGORY_LABELS, SCORED_CATEGORIES } from "@/audit/score";
import { FindingsList } from "./findings";
import { CategoryTiles, type CategoryTile } from "./category-tiles";
import { Delta, scoreTone } from "./ui";

// A row of score tiles, then one collapsible section per category: the score,
// what the category covers and the finding count in the header; the findings
// inside. Sections start closed; a tile opens its section and scrolls to it.
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
  openAll = false,
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
  openAll?: boolean;
}) {
  const hasAi = findings.some((f) => f.category === "ai");
  const cats: CategoryKey[] = hasAi ? [...SCORED_CATEGORIES, "ai"] : [...SCORED_CATEGORIES];
  const listFor = (cat: CategoryKey) => findings.filter((f) => f.category === cat && (showIgnored || !f.ignored) && (severity === "all" || f.severity === severity));
  const tiles: CategoryTile[] = cats.map((cat) => ({
    cat,
    label: CATEGORY_LABELS[cat],
    hint: CATEGORY_HINTS[cat],
    score: cat === "ai" ? undefined : scores?.[cat],
    before: previousScores ? previousScores[cat] : undefined,
    count: listFor(cat).length,
    note: cat === "ai" ? (aiSummary && aiSummary.answers > 0 ? `${aiSummary.mentioned}/${aiSummary.answers} mentioned` : "sampled") : undefined,
  }));
  return (
    <div className="space-y-3">
      <CategoryTiles tiles={tiles} />
      {cats.map((cat) => {
        const list = listFor(cat);
        const score = cat === "ai" ? undefined : scores?.[cat];
        const tone = scoreTone(score);
        const count = list.length;
        return (
          <details key={cat} id={`area-${cat}`} open={openAll} className="group scroll-mt-4 rounded-xl border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="w-3 shrink-0 text-ink-3 transition-transform group-open:rotate-90">
                ▸
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink">{CATEGORY_LABELS[cat]}</div>
                <div className="text-xs text-ink-3">{CATEGORY_HINTS[cat]}</div>
              </div>
              <div className="hidden text-xs text-ink-3 sm:block">
                {count === 0 ? <span className="font-medium text-good-text">Nothing found</span> : <span className="num">{count} finding{count === 1 ? "" : "s"}</span>}
              </div>
              {cat !== "ai" && previousScores && <Delta now={score} before={previousScores[cat]} />}
              {cat === "ai" ? (
                <div className="w-20 text-right text-xs text-ink-3">{aiSummary && aiSummary.answers > 0 ? <span className="num">{aiSummary.mentioned}/{aiSummary.answers} mentioned</span> : "sampled"}</div>
              ) : (
                <div className={`num w-12 text-right text-2xl font-semibold leading-none ${tone === "critical" ? "text-critical-text" : "text-ink"}`}>{score ?? "–"}</div>
              )}
            </summary>
            <div className="border-t border-line">
              {count === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-3">{cat === "conversion" && score === undefined ? "New area: scored from the next audit." : "Nothing found in this area."}</p>
              ) : (
                <FindingsList findings={list} category={cat} siteId={siteId} baseUrl={baseUrl} back={back} proposals={proposals} newFingerprints={newFingerprints} showIgnored={showIgnored} readOnly={readOnly} />
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
