import type { AnalysisInput, FindingDraft, PsiResult } from "../types";

const REGRESSION_POINTS = 10;

export function performanceChecks(input: AnalysisInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const prev = new Map(input.previousPsi.map((r) => [`${r.pagePath}|${r.strategy}`, r]));

  for (const r of input.psi) {
    const ref = { pagePath: r.pagePath, subject: r.strategy, data: { strategy: r.strategy, opportunities: r.opportunities } };
    if (r.error || r.performanceScore === null) {
      out.push({ category: "performance", checkId: "perf.psi-failed", severity: "info", title: `PageSpeed run failed (${r.strategy})`, detail: r.error ?? "no score returned", ...ref });
      continue;
    }
    const s = r.performanceScore;
    if (s < 50) out.push({ category: "performance", checkId: "perf.score-poor", severity: "high", title: `Performance score ${s}/100 on ${r.strategy}`, detail: topOpportunities(r), ...ref });
    else if (s < 90) out.push({ category: "performance", checkId: "perf.score-needs-work", severity: "medium", title: `Performance score ${s}/100 on ${r.strategy}`, detail: topOpportunities(r), ...ref });

    if (r.lcpMs !== null && r.lcpMs > 2500) out.push({ category: "performance", checkId: "perf.lcp-slow", severity: r.lcpMs > 4000 ? "high" : "medium", title: `LCP ${(r.lcpMs / 1000).toFixed(1)}s on ${r.strategy} (target under 2.5s)`, ...ref });
    if (r.cls !== null && r.cls > 0.1) out.push({ category: "performance", checkId: "perf.cls-high", severity: r.cls > 0.25 ? "high" : "medium", title: `CLS ${r.cls.toFixed(2)} on ${r.strategy} (target under 0.1)`, ...ref });
    if (r.tbtMs !== null && r.tbtMs > 300) out.push({ category: "performance", checkId: "perf.tbt-high", severity: r.tbtMs > 600 ? "medium" : "low", title: `Total blocking time ${Math.round(r.tbtMs)}ms on ${r.strategy}`, ...ref });
    if (r.totalBytes !== null && r.totalBytes > 3_000_000) out.push({ category: "performance", checkId: "perf.page-weight", severity: r.totalBytes > 6_000_000 ? "medium" : "low", title: `Page weight ${(r.totalBytes / 1_000_000).toFixed(1)} MB on ${r.strategy}`, ...ref });

    // Field data (real users) when CrUX has enough traffic for the URL.
    if (r.fieldInpMs !== null && r.fieldInpMs > 200) out.push({ category: "performance", checkId: "perf.field-inp", severity: r.fieldInpMs > 500 ? "high" : "medium", title: `Real-user INP ${Math.round(r.fieldInpMs)}ms on ${r.strategy} (target under 200ms)`, ...ref });
    if (r.fieldLcpMs !== null && r.fieldLcpMs > 2500) out.push({ category: "performance", checkId: "perf.field-lcp", severity: r.fieldLcpMs > 4000 ? "high" : "medium", title: `Real-user LCP ${(r.fieldLcpMs / 1000).toFixed(1)}s on ${r.strategy}`, ...ref });

    const before = prev.get(`${r.pagePath}|${r.strategy}`);
    if (before?.performanceScore != null && before.performanceScore - s >= REGRESSION_POINTS) {
      out.push({ category: "performance", checkId: "perf.regression", severity: "high", title: `Performance dropped ${before.performanceScore - s} points since the last run (${before.performanceScore} → ${s}, ${r.strategy})`, detail: "Lab scores vary a few points between runs; a drop this large usually follows a publish. Check the publish diff for new scripts or images.", ...ref });
    }
  }
  return out;
}

function topOpportunities(r: PsiResult): string | undefined {
  if (r.opportunities.length === 0) return undefined;
  return "Biggest savings: " + r.opportunities.slice(0, 3).map((o) => `${o.title} (~${(o.savingsMs / 1000).toFixed(1)}s)`).join("; ");
}
