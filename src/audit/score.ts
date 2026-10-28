import type { CategoryKey, CategoryScores, Severity } from "@/db/schema";
import type { FindingDraft } from "./types";

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  seo: "SEO",
  aeo: "AEO / GEO",
  performance: "Performance",
  trust: "Trust & identity",
  links: "Links",
  unused: "Unused CSS & scripts",
  naming: "Naming",
  ai: "AI visibility",
};

// Every category, for grouping findings.
export const CATEGORY_ORDER: CategoryKey[] = ["seo", "aeo", "performance", "trust", "links", "unused", "naming", "ai"];
// Categories that carry a score and feed the overall number. AI visibility is a
// sample and is reported on its own.
export const SCORED_CATEGORIES: CategoryKey[] = ["seo", "aeo", "performance", "trust", "links", "unused", "naming"];

const CATEGORY_WEIGHT: Record<CategoryKey, number> = {
  seo: 22,
  aeo: 18,
  performance: 18,
  trust: 12,
  links: 12,
  unused: 9,
  naming: 9,
  ai: 0,
};

const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 20,
  high: 8,
  medium: 3,
  low: 1,
  info: 0,
};

// Penalties use diminishing returns per check so that 40 pages missing a meta
// description don't zero the score on their own, while still ranking worse
// than 2 pages missing one.
export function scoreCategories(findings: FindingDraft[]): { scores: CategoryScores; overall: number } {
  const scores: CategoryScores = {};
  for (const cat of CATEGORY_ORDER) {
    const byCheck = new Map<string, Severity[]>();
    for (const f of findings) {
      if (f.category !== cat) continue;
      if (!byCheck.has(f.checkId)) byCheck.set(f.checkId, []);
      byCheck.get(f.checkId)!.push(f.severity);
    }
    let penalty = 0;
    for (const sevs of byCheck.values()) {
      const worst = sevs.reduce((a, b) => (SEVERITY_PENALTY[b] > SEVERITY_PENALTY[a] ? b : a), "info" as Severity);
      const n = sevs.length;
      penalty += SEVERITY_PENALTY[worst] * (1 + Math.log2(n)) ;
    }
    scores[cat] = Math.max(0, Math.round(100 - penalty));
  }
  let weighted = 0;
  let totalWeight = 0;
  for (const cat of SCORED_CATEGORIES) {
    weighted += (scores[cat] ?? 100) * CATEGORY_WEIGHT[cat];
    totalWeight += CATEGORY_WEIGHT[cat];
  }
  return { scores, overall: Math.round(weighted / totalWeight) };
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
