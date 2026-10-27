// The audit pipeline as independent steps. The Workflow (production) and the
// inline runner (local dev / fallback) both call these in order; each step
// re-reads what it needs from D1 and R2 so it can be retried on its own.

import { and, desc, eq, inArray } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import type { CategoryKey, RunSummary, Severity } from "@/db/schema";
import { newId, nowIso, sha256Hex } from "@/lib/id";
import { webflow, siteBaseUrl } from "@/lib/webflow/client";
import { crawlSite } from "./crawl";
import { checkLinks } from "./links";
import { runPsi } from "./psi";
import { getJson, putJson, runKey } from "./store";
import { aeoChecks } from "./checks/aeo";
import { linkChecks } from "./checks/links";
import { namingChecks } from "./checks/naming";
import { performanceChecks } from "./checks/performance";
import { seoChecks } from "./checks/seo";
import { unusedChecks } from "./checks/unused";
import { CATEGORY_ORDER, scoreCategories } from "./score";
import type { AnalysisInput, CrawlResult, FindingDraft, LinkCheckResult, PsiResult, WebflowSnapshot } from "./types";

const MAX_LINKS = 400;

export type RunEnv = Pick<CloudflareEnv, "DB" | "AUDIT_STORE"> & { PSI_API_KEY?: string };

async function loadRun(env: RunEnv, runId: string) {
  const db = dbFromEnv(env);
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) throw new Error(`run ${runId} not found`);
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId) });
  if (!site) throw new Error(`site ${run.siteId} not found`);
  const connection = site.connectionId
    ? await db.query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, site.connectionId) })
    : null;
  return { db, run, site, connection };
}

// Step 1: mark running, pull everything we need from the Webflow Data API.
export async function stepPrepare(env: RunEnv, runId: string): Promise<{ pages: number }> {
  const { db, run, site, connection } = await loadRun(env, runId);
  await db.update(schema.runs).set({ status: "running", startedAt: nowIso(), error: null }).where(eq(schema.runs.id, run.id));
  if (!connection || connection.revokedAt) throw new Error("Site has no active Webflow connection");
  const token = connection.accessToken;

  const [wfSite, pages, registeredScripts, siteCustomCode, pageCustomCode] = await Promise.all([
    webflow.getSite(token, site.webflowSiteId),
    webflow.listPages(token, site.webflowSiteId),
    webflow.listRegisteredScripts(token, site.webflowSiteId).catch(() => []),
    webflow.getSiteCustomCode(token, site.webflowSiteId).catch(() => null),
    webflow.listPageCustomCode(token, site.webflowSiteId).catch(() => []),
  ]);
  const snapshot: WebflowSnapshot = { site: wfSite, pages, registeredScripts, siteCustomCode, pageCustomCode, fetchedAt: nowIso() };
  await putJson(env.AUDIT_STORE, runKey(runId, "webflow"), snapshot);

  // Keep the stored base URL in sync with Webflow's custom domain list.
  const base = siteBaseUrl(wfSite);
  if (base !== site.baseUrl) await db.update(schema.sites).set({ baseUrl: base }).where(eq(schema.sites.id, site.id));
  return { pages: pages.length };
}

// Step 2: crawl the published site.
export async function stepCrawl(env: RunEnv, runId: string): Promise<{ pages: number; truncated: boolean }> {
  const { site } = await loadRun(env, runId);
  const snapshot = await getJson<WebflowSnapshot>(env.AUDIT_STORE, runKey(runId, "webflow"));
  if (!snapshot) throw new Error("webflow snapshot missing");
  const seedPaths = snapshot.pages
    .filter((p) => !p.draft && !p.archived && !p.collectionId && p.publishedPath)
    .map((p) => p.publishedPath!);
  const crawl = await crawlSite({ baseUrl: site.baseUrl, seedPaths, maxPages: site.maxPages });
  await putJson(env.AUDIT_STORE, runKey(runId, "crawl"), crawl);
  return { pages: crawl.pages.length, truncated: crawl.truncated };
}

// Step 3: check every unique link found during the crawl.
export async function stepLinks(env: RunEnv, runId: string): Promise<{ checked: number }> {
  const crawl = await getJson<CrawlResult>(env.AUDIT_STORE, runKey(runId, "crawl"));
  if (!crawl) throw new Error("crawl result missing");
  const knownPages = new Map<string, number>();
  for (const p of crawl.pages) {
    knownPages.set(p.url, p.status);
    if (!p.url.endsWith("/")) knownPages.set(p.url + "/", p.status);
  }
  const links = await checkLinks(crawl, { maxUrls: MAX_LINKS, knownPages });
  await putJson(env.AUDIT_STORE, runKey(runId, "links"), links);
  return { checked: links.length };
}

// Step 4: PageSpeed Insights for the site's key pages.
export async function stepPsi(env: RunEnv, runId: string): Promise<{ runs: number }> {
  const { db, run, site } = await loadRun(env, runId);
  const results: PsiResult[] = [];
  const keyPages = (site.keyPages.length ? site.keyPages : ["/"]).slice(0, 5);
  for (const path of keyPages) {
    const url = new URL(path, site.baseUrl).toString();
    const mobile = await runPsi(url, path, "mobile", env.PSI_API_KEY);
    results.push(mobile);
    if (keyPages.length <= 3) results.push(await runPsi(url, path, "desktop", env.PSI_API_KEY));
  }
  await putJson(env.AUDIT_STORE, runKey(runId, "psi"), results);
  const rows = results
    .filter((r) => !r.error)
    .map((r) => ({
      id: newId(),
      runId: run.id,
      siteId: site.id,
      pagePath: r.pagePath,
      strategy: r.strategy,
      performanceScore: r.performanceScore,
      lcpMs: r.lcpMs,
      cls: r.cls,
      inpMs: r.inpMs,
      tbtMs: r.tbtMs,
      fcpMs: r.fcpMs,
      totalBytes: r.totalBytes,
      fieldLcpMs: r.fieldLcpMs,
      fieldCls: r.fieldCls,
      fieldInpMs: r.fieldInpMs,
      raw: { opportunities: r.opportunities },
    }));
  if (rows.length) await db.insert(schema.pageMetrics).values(rows);
  return { runs: results.length };
}

// Step 5: run every check, score, diff against the previous run, persist.
export async function stepAnalyze(env: RunEnv, runId: string): Promise<{ findings: number; overall: number }> {
  const { db, run, site } = await loadRun(env, runId);
  const [snapshot, crawl, links, psi] = await Promise.all([
    getJson<WebflowSnapshot>(env.AUDIT_STORE, runKey(runId, "webflow")),
    getJson<CrawlResult>(env.AUDIT_STORE, runKey(runId, "crawl")),
    getJson<LinkCheckResult[]>(env.AUDIT_STORE, runKey(runId, "links")),
    getJson<PsiResult[]>(env.AUDIT_STORE, runKey(runId, "psi")),
  ]);
  if (!snapshot || !crawl) throw new Error("run artifacts missing");

  const previousRun = await db.query.runs.findFirst({
    where: and(eq(schema.runs.siteId, site.id), eq(schema.runs.status, "complete")),
    orderBy: desc(schema.runs.createdAt),
  });
  const previousPsi = previousRun ? ((await getJson<PsiResult[]>(env.AUDIT_STORE, runKey(previousRun.id, "psi"))) ?? []) : [];

  const input: AnalysisInput = {
    siteBaseUrl: site.baseUrl,
    hasCustomDomain: (snapshot.site.customDomains?.length ?? 0) > 0,
    webflow: snapshot,
    crawl,
    links: links ?? [],
    psi: psi ?? [],
    previousPsi,
  };

  const drafts: FindingDraft[] = [
    ...seoChecks(input),
    ...aeoChecks(input),
    ...performanceChecks(input),
    ...linkChecks(input),
    ...unusedChecks(input),
    ...namingChecks(input),
  ];

  // Ignore rules suppress findings from scoring and from the "open" list.
  const rules = await db.query.ignoreRules.findMany({ where: eq(schema.ignoreRules.siteId, site.id) });
  const isIgnored = (f: FindingDraft) =>
    rules.some((r) => r.checkId === f.checkId && (r.pagePath === null || r.pagePath === f.pagePath));

  const withMeta = await Promise.all(
    drafts.map(async (f) => ({
      draft: f,
      fingerprint: (await sha256Hex(`${f.checkId}|${f.pagePath ?? ""}|${f.subject ?? ""}`)).slice(0, 24),
      ignored: isIgnored(f),
    })),
  );
  const active = withMeta.filter((f) => !f.ignored);
  const { scores, overall } = scoreCategories(active.map((f) => f.draft));

  // Persist findings in small chunks (D1 caps bound parameters per statement).
  const findingRows = withMeta.map((f) => ({
    id: newId(),
    runId: run.id,
    siteId: site.id,
    category: f.draft.category,
    checkId: f.draft.checkId,
    severity: f.draft.severity,
    title: f.draft.title,
    detail: f.draft.detail ?? null,
    pagePath: f.draft.pagePath ?? null,
    webflowPageId: f.draft.webflowPageId ?? null,
    fingerprint: f.fingerprint,
    data: f.draft.data ?? null,
    ignored: f.ignored,
  }));
  for (let i = 0; i < findingRows.length; i += 7) {
    await db.insert(schema.findings).values(findingRows.slice(i, i + 7));
  }

  // Finding lifecycle across runs.
  const states = await db.query.findingStates.findMany({ where: eq(schema.findingStates.siteId, site.id) });
  const stateByFp = new Map(states.map((s) => [s.fingerprint, s]));
  const seenFps = new Set(active.map((f) => f.fingerprint));
  let newFindings = 0;
  let resolvedFindings = 0;
  const now = nowIso();

  for (const fp of seenFps) {
    const existing = stateByFp.get(fp);
    if (!existing) {
      newFindings++;
      await db.insert(schema.findingStates).values({ siteId: site.id, fingerprint: fp, status: "open", firstSeenRunId: run.id, lastSeenRunId: run.id, updatedAt: now });
    } else if (existing.status === "fixed") {
      await db
        .update(schema.findingStates)
        .set({ status: "open", lastSeenRunId: run.id, resolvedRunId: null, updatedAt: now })
        .where(and(eq(schema.findingStates.siteId, site.id), eq(schema.findingStates.fingerprint, fp)));
    } else {
      await db
        .update(schema.findingStates)
        .set({ lastSeenRunId: run.id, updatedAt: now })
        .where(and(eq(schema.findingStates.siteId, site.id), eq(schema.findingStates.fingerprint, fp)));
    }
  }
  const toResolve = states.filter((s) => s.status === "open" && !seenFps.has(s.fingerprint)).map((s) => s.fingerprint);
  for (let i = 0; i < toResolve.length; i += 50) {
    const chunk = toResolve.slice(i, i + 50);
    await db
      .update(schema.findingStates)
      .set({ status: "fixed", resolvedRunId: run.id, updatedAt: now })
      .where(and(eq(schema.findingStates.siteId, site.id), inArray(schema.findingStates.fingerprint, chunk)));
    resolvedFindings += chunk.length;
  }

  // Snapshots for publish-diff: hash the parts of the site that change on publish.
  const snapshotHashes = {
    pages: await sha256Hex(JSON.stringify(snapshot.pages.map((p) => [p.id, p.slug, p.publishedPath, p.seo, p.openGraph, p.draft, p.archived]))),
    scripts: await sha256Hex(JSON.stringify([snapshot.siteCustomCode?.scripts ?? [], snapshot.pageCustomCode.map((b) => [b.pageId, b.scripts])])),
    css_classes: await sha256Hex(JSON.stringify(Object.values(crawl.stylesheetClasses).flat().sort())),
  } as const;
  const prevSnapshots = previousRun
    ? await db.query.snapshots.findMany({ where: eq(schema.snapshots.runId, previousRun.id) })
    : [];
  const changes: string[] = [];
  for (const [kind, hash] of Object.entries(snapshotHashes) as [keyof typeof snapshotHashes, string][]) {
    await db.insert(schema.snapshots).values({ id: newId(), runId: run.id, siteId: site.id, kind, r2Key: runKey(run.id, kind === "css_classes" ? "crawl" : kind === "scripts" ? "webflow" : "webflow"), hash });
    const prev = prevSnapshots.find((s) => s.kind === kind);
    if (prev && prev.hash !== hash) changes.push(kind);
  }

  const bySeverity = Object.fromEntries(["critical", "high", "medium", "low", "info"].map((s) => [s, 0])) as Record<Severity, number>;
  const byCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<CategoryKey, number>;
  for (const f of active) {
    bySeverity[f.draft.severity]++;
    byCategory[f.draft.category]++;
  }
  const summary: RunSummary = {
    pagesCrawled: crawl.pages.length,
    findingsBySeverity: bySeverity,
    findingsByCategory: byCategory,
    newFindings,
    resolvedFindings,
    changedSinceLastRun: changes,
  };
  await db.update(schema.runs).set({ scoreOverall: overall, scores, summary }).where(eq(schema.runs.id, run.id));
  return { findings: active.length, overall };
}

// Step 6: mark complete (or failed) and advance the site's schedule.
export async function stepFinalize(env: RunEnv, runId: string, error?: string): Promise<void> {
  const { db, run, site } = await loadRun(env, runId);
  await db
    .update(schema.runs)
    .set({ status: error ? "failed" : "complete", finishedAt: nowIso(), error: error ?? null })
    .where(eq(schema.runs.id, run.id));
  if (!error) await db.update(schema.sites).set({ lastRunId: run.id }).where(eq(schema.sites.id, site.id));
}

export async function runAuditInline(env: RunEnv, runId: string): Promise<void> {
  try {
    await stepPrepare(env, runId);
    await stepCrawl(env, runId);
    await stepLinks(env, runId);
    await stepPsi(env, runId);
    await stepAnalyze(env, runId);
    await stepFinalize(env, runId);
  } catch (e) {
    await stepFinalize(env, runId, (e as Error).message ?? String(e)).catch(() => {});
    throw e;
  }
}
