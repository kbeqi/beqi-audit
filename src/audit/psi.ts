// Core Web Vitals from Google's PageSpeed Insights API, measured for the site's
// key pages on mobile. Field data (CrUX, what real visitors experienced over the
// last 28 days) is preferred; lab data (one Lighthouse run) fills the gaps.
// Findings from here are deterministic: the agent never estimates vitals.

import { eq } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import { newId } from "@/lib/id";
import { CHECKS, type CheckId } from "@/agent/catalog";
import type { FindingDraft } from "./types";

export type PsiEnv = Pick<CloudflareEnv, "DB" | "PSI_API_KEY">;

const MAX_PAGES = 5;
const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const TIMEOUT_MS = 70_000;

// Google's thresholds (good / needs improvement / poor).
export const THRESHOLDS = {
  lcpMs: { good: 2500, poor: 4000 },
  inpMs: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const;

export type VitalTone = "good" | "warning" | "serious";

export function vitalTone(metric: keyof typeof THRESHOLDS, value: number | null | undefined): VitalTone | null {
  if (value === null || value === undefined) return null;
  const t = THRESHOLDS[metric];
  if (value <= t.good) return "good";
  if (value <= t.poor) return "warning";
  return "serious";
}

export interface PagePsi {
  pagePath: string;
  ok: boolean;
  error?: string;
  performanceScore: number | null;
  // Lab (Lighthouse)
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  totalBytes: number | null;
  // Field (CrUX, 75th percentile), null when the page has too little traffic.
  fieldLcpMs: number | null;
  fieldInpMs: number | null;
  fieldCls: number | null;
  hasField: boolean;
}

export interface PsiResult {
  pages: PagePsi[];
  findings: FindingDraft[];
  // Short text for the audit agent's task prompt.
  summaryText: string | null;
  summary: { pages: number; passing: number; unavailable: boolean };
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, { numericValue?: number }>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number }>;
    overall_category?: string;
  };
  error?: { message?: string };
}

async function measure(url: string, key: string | undefined): Promise<Omit<PagePsi, "pagePath">> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (key) q.set("key", key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${q}`, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as PsiResponse;
    if (!res.ok) {
      return { ...empty(), ok: false, error: body.error?.message ?? `HTTP ${res.status}` };
    }
    const audits = body.lighthouseResult?.audits ?? {};
    const field = body.loadingExperience?.metrics ?? {};
    const num = (id: string) => (typeof audits[id]?.numericValue === "number" ? audits[id].numericValue! : null);
    const pct = (id: string) => (typeof field[id]?.percentile === "number" ? field[id].percentile! : null);
    const score = body.lighthouseResult?.categories?.performance?.score;
    const fieldLcpMs = pct("LARGEST_CONTENTFUL_PAINT_MS");
    const fieldInpMs = pct("INTERACTION_TO_NEXT_PAINT");
    const fieldClsRaw = pct("CUMULATIVE_LAYOUT_SHIFT_SCORE");
    return {
      ok: true,
      performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
      lcpMs: num("largest-contentful-paint"),
      cls: num("cumulative-layout-shift"),
      tbtMs: num("total-blocking-time"),
      fcpMs: num("first-contentful-paint"),
      totalBytes: num("total-byte-weight"),
      fieldLcpMs,
      fieldInpMs,
      // CrUX reports CLS multiplied by 100.
      fieldCls: fieldClsRaw === null ? null : fieldClsRaw / 100,
      hasField: fieldLcpMs !== null || fieldInpMs !== null || fieldClsRaw !== null,
    };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "timed out" : ((e as Error).message ?? String(e));
    return { ...empty(), ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function empty(): Omit<PagePsi, "pagePath"> {
  return { ok: false, performanceScore: null, lcpMs: null, cls: null, tbtMs: null, fcpMs: null, totalBytes: null, fieldLcpMs: null, fieldInpMs: null, fieldCls: null, hasField: false };
}

// Which value stands for a metric: field when there is one, else lab.
function effective(p: PagePsi): { lcpMs: number | null; inpMs: number | null; cls: number | null; source: "field" | "lab" } {
  if (p.hasField) return { lcpMs: p.fieldLcpMs ?? p.lcpMs, inpMs: p.fieldInpMs, cls: p.fieldCls ?? p.cls, source: "field" };
  return { lcpMs: p.lcpMs, inpMs: null, cls: p.cls, source: "lab" };
}

export const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const fmtCls = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toFixed(2));

function draft(checkId: CheckId, pagePath: string, title: string, detail: string, evidence: string[]): FindingDraft {
  const def = CHECKS[checkId];
  return { category: def.category, checkId, severity: def.severity, title, detail, pagePath, data: { subject: null, evidence, source: "psi" }, confidence: "high", effort: "moderate" };
}

export function psiFindings(pages: PagePsi[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const p of pages) {
    if (!p.ok) {
      out.push({ ...draft("perf.psi-unavailable", p.pagePath, `PageSpeed could not measure ${p.pagePath}`, `PageSpeed Insights failed for this page: ${p.error ?? "unknown error"}.`, [p.error ?? "error"]), effort: "quick" });
      continue;
    }
    const e = effective(p);
    const src = e.source === "field" ? "real visitors (CrUX, 75th percentile)" : "a lab run (Lighthouse)";
    const lcp = vitalTone("lcpMs", e.lcpMs);
    if (lcp === "serious") out.push(draft("perf.lcp-poor", p.pagePath, `LCP ${fmtMs(e.lcpMs)} on ${p.pagePath}`, `Largest Contentful Paint measured at ${fmtMs(e.lcpMs)} on mobile from ${src}; Google's good threshold is 2.5 s.`, [`LCP ${fmtMs(e.lcpMs)} (${e.source})`]));
    else if (lcp === "warning") out.push(draft("perf.lcp-needs-work", p.pagePath, `LCP ${fmtMs(e.lcpMs)} on ${p.pagePath}`, `Largest Contentful Paint measured at ${fmtMs(e.lcpMs)} on mobile from ${src}; good is 2.5 s or under.`, [`LCP ${fmtMs(e.lcpMs)} (${e.source})`]));
    const inp = vitalTone("inpMs", e.inpMs);
    if (inp === "serious") out.push(draft("perf.inp-poor", p.pagePath, `INP ${fmtMs(e.inpMs)} on ${p.pagePath}`, `Interaction to Next Paint for real visitors is ${fmtMs(e.inpMs)}; good is 200 ms or under.`, [`INP ${fmtMs(e.inpMs)} (field)`]));
    else if (inp === "warning") out.push(draft("perf.inp-needs-work", p.pagePath, `INP ${fmtMs(e.inpMs)} on ${p.pagePath}`, `Interaction to Next Paint for real visitors is ${fmtMs(e.inpMs)}; good is 200 ms or under.`, [`INP ${fmtMs(e.inpMs)} (field)`]));
    const cls = vitalTone("cls", e.cls);
    if (cls === "serious") out.push(draft("perf.cls-poor", p.pagePath, `CLS ${fmtCls(e.cls)} on ${p.pagePath}`, `Cumulative Layout Shift measured at ${fmtCls(e.cls)} from ${src}; good is 0.1 or under. Usually unsized images, late-loading fonts or injected banners.`, [`CLS ${fmtCls(e.cls)} (${e.source})`]));
    else if (cls === "warning") out.push(draft("perf.cls-needs-work", p.pagePath, `CLS ${fmtCls(e.cls)} on ${p.pagePath}`, `Cumulative Layout Shift measured at ${fmtCls(e.cls)} from ${src}; good is 0.1 or under.`, [`CLS ${fmtCls(e.cls)} (${e.source})`]));
    if (p.performanceScore !== null && p.performanceScore < 50) {
      out.push(draft("perf.score-poor", p.pagePath, `Lighthouse performance ${p.performanceScore} on ${p.pagePath}`, `Mobile Lighthouse performance score is ${p.performanceScore}/100 (TBT ${fmtMs(p.tbtMs)}, page weight ${p.totalBytes ? `${Math.round(p.totalBytes / 1024)} KB` : "n/a"}).`, [`score ${p.performanceScore}`, `TBT ${fmtMs(p.tbtMs)}`]));
    }
  }
  return out;
}

export function psiPassing(p: PagePsi): boolean {
  if (!p.ok) return false;
  const e = effective(p);
  return vitalTone("lcpMs", e.lcpMs) !== "serious" && vitalTone("lcpMs", e.lcpMs) !== "warning" && (e.inpMs === null || vitalTone("inpMs", e.inpMs) === "good") && vitalTone("cls", e.cls) !== "serious" && vitalTone("cls", e.cls) !== "warning";
}

export function psiSummaryText(pages: PagePsi[]): string | null {
  const ok = pages.filter((p) => p.ok);
  if (ok.length === 0) return pages.length ? `PageSpeed Insights could not measure any page (${pages[0]?.error ?? "error"}).` : null;
  return ok
    .map((p) => {
      const e = effective(p);
      return `- ${p.pagePath}: score ${p.performanceScore ?? "n/a"}, LCP ${fmtMs(e.lcpMs)}, INP ${fmtMs(e.inpMs)}, CLS ${fmtCls(e.cls)} (${e.source}${p.tbtMs !== null ? `, TBT ${fmtMs(p.tbtMs)}` : ""}${p.totalBytes ? `, ${Math.round(p.totalBytes / 1024)} KB` : ""})`;
    })
    .join("\n");
}

// Measures the key pages, stores page_metrics rows, returns findings + summary.
export async function measureKeyPages(env: PsiEnv, runId: string, siteId: string, baseUrl: string, keyPages: string[]): Promise<PsiResult> {
  const base = baseUrl.replace(/\/$/, "");
  const paths = [...new Set(keyPages.length ? keyPages : ["/"])].slice(0, MAX_PAGES).map((p) => (p.startsWith("/") ? p : `/${p}`));
  // Two at a time: PSI is slow (20-60 s per page) and rate-limited without a key.
  const pages: PagePsi[] = [];
  for (let i = 0; i < paths.length; i += 2) {
    const batch = await Promise.all(paths.slice(i, i + 2).map(async (pagePath) => ({ pagePath, ...(await measure(`${base}${pagePath}`, env.PSI_API_KEY)) })));
    pages.push(...batch);
  }
  const db = dbFromEnv(env);
  for (const p of pages) {
    if (!p.ok) continue;
    await db.insert(schema.pageMetrics).values({
      id: newId(),
      runId,
      siteId,
      pagePath: p.pagePath,
      strategy: "mobile",
      performanceScore: p.performanceScore,
      lcpMs: p.lcpMs,
      cls: p.cls,
      tbtMs: p.tbtMs,
      fcpMs: p.fcpMs,
      totalBytes: p.totalBytes,
      fieldLcpMs: p.fieldLcpMs,
      fieldCls: p.fieldCls,
      fieldInpMs: p.fieldInpMs,
      inpMs: p.fieldInpMs,
      raw: { hasField: p.hasField },
    });
  }
  const findings = psiFindings(pages);
  return {
    pages,
    findings,
    summaryText: psiSummaryText(pages),
    summary: { pages: pages.length, passing: pages.filter(psiPassing).length, unavailable: pages.every((p) => !p.ok) },
  };
}

// Reads a run's stored metrics back for the UI.
export async function runMetrics(env: Pick<CloudflareEnv, "DB">, runId: string) {
  const db = dbFromEnv(env);
  return db.query.pageMetrics.findMany({ where: eq(schema.pageMetrics.runId, runId) });
}
