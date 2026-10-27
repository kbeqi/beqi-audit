import type { PsiResult } from "./types";

// Google PageSpeed Insights v5. Works without a key at low volume; with a key
// the quota is ~25k requests/day. Lab numbers vary run to run, so callers
// should treat a single run as a sample and compare medians over time.

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function runPsi(
  pageUrl: string,
  pagePath: string,
  strategy: "mobile" | "desktop",
  apiKey?: string,
): Promise<PsiResult> {
  const u = new URL(ENDPOINT);
  u.searchParams.set("url", pageUrl);
  u.searchParams.set("strategy", strategy);
  u.searchParams.set("category", "performance");
  if (apiKey) u.searchParams.set("key", apiKey);

  const empty: PsiResult = {
    pagePath,
    strategy,
    performanceScore: null,
    lcpMs: null,
    cls: null,
    tbtMs: null,
    fcpMs: null,
    inpMs: null,
    totalBytes: null,
    fieldLcpMs: null,
    fieldCls: null,
    fieldInpMs: null,
    opportunities: [],
  };

  try {
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return { ...empty, error: `PSI ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const json = (await res.json()) as PsiResponse;
    const lh = json.lighthouseResult;
    const audits = lh?.audits ?? {};
    const num = (id: string) => audits[id]?.numericValue ?? null;
    const field = json.loadingExperience?.metrics ?? {};
    const opportunities = Object.values(audits)
      .filter((a) => a.details?.type === "opportunity" && (a.details.overallSavingsMs ?? 0) > 100)
      .map((a) => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details!.overallSavingsMs!) }))
      .sort((a, b) => b.savingsMs - a.savingsMs)
      .slice(0, 8);
    return {
      ...empty,
      performanceScore: lh?.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null,
      lcpMs: num("largest-contentful-paint"),
      cls: num("cumulative-layout-shift"),
      tbtMs: num("total-blocking-time"),
      fcpMs: num("first-contentful-paint"),
      inpMs: num("interaction-to-next-paint"),
      totalBytes: num("total-byte-weight"),
      fieldLcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      fieldCls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
      fieldInpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
      opportunities,
    };
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score: number | null } };
    audits?: Record<
      string,
      { id: string; title: string; numericValue?: number; details?: { type?: string; overallSavingsMs?: number } }
    >;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile: number; category: string }>;
  };
}
