// The migration and indexability guard: a deterministic inventory of every
// URL the site should serve, checked live, and compared with the previous
// audit. No model involved; the agent gets a short summary and never repeats
// these checks.
//
// Sources: Webflow's page list (published static pages and their sitemap
// flags, read through the MCP server) and the live sitemap.xml. Every URL is
// fetched once (status, redirect target, meta robots, canonical). The result
// is stored in KV under runs/<id>/inventory; stepAnalyze merges the findings.

import type { Site, WebflowConnection } from "@/db/schema";
import { WebflowSession } from "@/lib/webflow/mcp-client";
import type { FindingDraft } from "./types";

export interface InventoryPage {
  path: string;
  // "webflow": a published static page; "sitemap": only listed in sitemap.xml
  // (CMS items, mostly); "both".
  source: "webflow" | "sitemap" | "both";
  webflowPageId?: string;
  title?: string;
  // Webflow's includeInSitemap flag (null when the tool does not cover the page).
  sitemapFlag: boolean | null;
  inSitemapXml: boolean;
  // HTTP status of the live URL; 0 = fetch failed.
  status: number;
  redirectTo: string | null;
  noindex: boolean;
  canonical: string | null;
}

export interface Inventory {
  checkedAt: string;
  baseUrl: string;
  robots: { status: number; blocksAll: boolean; sample: string };
  sitemap: { status: number; urls: number; indexes: number };
  pages: InventoryPage[];
  // True when more URLs existed than the fetch cap allowed.
  truncated: boolean;
  errors: string[];
}

export interface InventorySummary {
  pages: number;
  ok: number;
  redirects: number;
  broken: number;
  noindex: number;
  sitemapUrls: number;
  robotsOk: boolean;
  sitemapOk: boolean;
  // Against the previous audit's inventory; null on the first guarded audit.
  changes: { gone: number; redirected: number; noindexed: number; sitemapDelta: number } | null;
}

const FETCH_CAP = 150;
const CONCURRENCY = 8;
const USER_AGENT = "BeqiAudit/1.0 (+https://beqi.co; site care checks)";
const UTILITY_SLUGS = new Set(["404", "401", "password", "search"]);

function normalizePath(p: string): string {
  const path = (p || "/").split("?")[0].split("#")[0].replace(/\/+$/, "");
  return path || "/";
}

function pathOfUrl(url: string, host: string): string | null {
  try {
    const u = new URL(url);
    if (u.host.replace(/^www\./, "") !== host.replace(/^www\./, "")) return null;
    return normalizePath(u.pathname);
  } catch {
    return null;
  }
}

// ---- Webflow ---------------------------------------------------------------------

interface McpPage {
  id: string;
  title?: string;
  slug?: string;
  draft?: boolean;
  archived?: boolean;
  collectionId?: string;
  publishedPath?: string;
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function webflowPages(session: WebflowSession, webflowSiteId: string): Promise<{ pages: McpPage[]; sitemapFlags: Map<string, boolean> }> {
  const pages: McpPage[] = [];
  for (let offset = 0, i = 0; i < 20; i++) {
    const text = await session.call(
      "data_pages_tool",
      { actions: [{ label: "pages", list_pages: { site_id: webflowSiteId, limit: 100, offset } }] },
      "Beqi Audit lists the site's pages to build the URL inventory checked on every audit for broken or de-indexed pages.",
    );
    const json = extractJson(text) as { result?: { pages?: McpPage[]; pagination?: { total?: number } } } | { result?: { pages?: McpPage[] } }[] | null;
    const first = Array.isArray(json) ? json[0] : json;
    const batch = first?.result?.pages;
    if (!Array.isArray(batch)) throw new Error(`Could not read the page list from Webflow: ${text.slice(0, 160)}`);
    pages.push(...batch.filter((p) => p && typeof p.id === "string"));
    const total = (first as { result?: { pagination?: { total?: number } } })?.result?.pagination?.total;
    offset += batch.length;
    if (batch.length === 0 || (typeof total === "number" && offset >= total)) break;
  }
  const sitemapFlags = new Map<string, boolean>();
  try {
    for (let offset = 0, i = 0; i < 20; i++) {
      const text = await session.call(
        "data_sitemap_tool",
        { actions: [{ label: "flags", list_pages_sitemap_status: { site_id: webflowSiteId, limit: 100, offset } }] },
        "Beqi Audit reads which pages are included in the generated sitemap, to flag indexable pages left out of it.",
      );
      const json = extractJson(text) as { result?: { pages?: { id: string; includeInSitemap?: boolean }[]; pagination?: { total?: number } } } | null;
      const first = (Array.isArray(json) ? json[0] : json) as { result?: { pages?: { id: string; includeInSitemap?: boolean }[]; pagination?: { total?: number } } } | null;
      const batch = first?.result?.pages;
      if (!Array.isArray(batch)) break;
      for (const p of batch) if (typeof p.includeInSitemap === "boolean") sitemapFlags.set(p.id, p.includeInSitemap);
      const total = first?.result?.pagination?.total;
      offset += batch.length;
      if (batch.length === 0 || (typeof total === "number" && offset >= total)) break;
    }
  } catch {
    /* sitemap flags are optional (the tool is beta) */
  }
  return { pages, sitemapFlags };
}

// ---- live site -------------------------------------------------------------------

async function fetchText(url: string, maxBytes = 64_000): Promise<{ status: number; headers: Headers; text: string }> {
  const res = await fetch(url, { redirect: "manual", headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml,text/plain,*/*" }, signal: AbortSignal.timeout(12_000) });
  let text = "";
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
  }
  return { status: res.status, headers: res.headers, text };
}

export function robotsBlocksAll(text: string): boolean {
  let agents: string[] = [];
  let inGroup = false;
  let blocks = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (inGroup) agents = [];
      inGroup = false;
      agents.push(value.toLowerCase());
    } else {
      inGroup = true;
      if (!agents.includes("*")) continue;
      if (key === "disallow" && value === "/") blocks = true;
      if (key === "allow" && value === "/") blocks = false;
    }
  }
  return blocks;
}

export async function readSitemap(baseUrl: string, host: string): Promise<{ status: number; paths: string[]; indexes: number }> {
  const seen = new Set<string>();
  const paths: string[] = [];
  let indexes = 0;
  const visit = async (url: string, depth: number): Promise<number> => {
    const { status, text } = await fetchText(url, 2_000_000);
    if (status !== 200) return status;
    const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
    const isIndex = /<sitemapindex/i.test(text);
    if (isIndex && depth < 1) {
      for (const child of locs.slice(0, 10)) {
        indexes++;
        await visit(child, depth + 1).catch(() => 0);
      }
    } else {
      for (const loc of locs) {
        const p = pathOfUrl(loc, host);
        if (p && !seen.has(p)) {
          seen.add(p);
          paths.push(p);
        }
      }
    }
    return status;
  };
  const status = await visit(`${baseUrl}/sitemap.xml`, 0).catch(() => 0);
  return { status, paths, indexes };
}

export async function checkPage(baseUrl: string, path: string): Promise<Pick<InventoryPage, "status" | "redirectTo" | "noindex" | "canonical">> {
  try {
    const { status, headers, text } = await fetchText(`${baseUrl}${path}`);
    const xRobots = headers.get("x-robots-tag") ?? "";
    let noindex = /noindex/i.test(xRobots);
    let canonical: string | null = null;
    if (status === 200 && /text\/html/i.test(headers.get("content-type") ?? "")) {
      const head = text.slice(0, 60_000);
      const robots = /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i.exec(head) ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']robots["']/i.exec(head);
      if (robots && /noindex/i.test(robots[1])) noindex = true;
      const canon = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(head) ?? /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(head);
      canonical = canon?.[1] ?? null;
    }
    const redirectTo = status >= 300 && status < 400 ? (headers.get("location") ?? null) : null;
    return { status, redirectTo, noindex, canonical };
  } catch {
    return { status: 0, redirectTo: null, noindex: false, canonical: null };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- build -----------------------------------------------------------------------

export async function buildInventory(opts: { site: Site; connection: WebflowConnection; mcpUrl: string }): Promise<Inventory> {
  const { site, connection } = opts;
  const baseUrl = site.baseUrl.replace(/\/$/, "");
  const host = new URL(baseUrl).host;
  const errors: string[] = [];

  let pages: McpPage[] = [];
  let sitemapFlags = new Map<string, boolean>();
  try {
    const session = await WebflowSession.open(opts.mcpUrl, connection.accessToken);
    try {
      ({ pages, sitemapFlags } = await webflowPages(session, site.webflowSiteId));
    } finally {
      await session.close();
    }
  } catch (e) {
    errors.push(`Webflow page list: ${String((e as Error).message ?? e).slice(0, 200)}`);
  }

  const [robotsRes, sitemapRes] = await Promise.all([fetchText(`${baseUrl}/robots.txt`, 20_000).catch(() => ({ status: 0, headers: new Headers(), text: "" })), readSitemap(baseUrl, host)]);
  const robots = { status: robotsRes.status, blocksAll: robotsRes.status === 200 && robotsBlocksAll(robotsRes.text), sample: robotsRes.text.slice(0, 1500) };

  const byPath = new Map<string, InventoryPage>();
  for (const p of pages) {
    if (p.draft || p.archived || p.collectionId || !p.publishedPath) continue;
    if (p.slug && UTILITY_SLUGS.has(p.slug)) continue;
    const path = normalizePath(p.publishedPath);
    byPath.set(path, { path, source: "webflow", webflowPageId: p.id, title: p.title, sitemapFlag: sitemapFlags.get(p.id) ?? null, inSitemapXml: false, status: 0, redirectTo: null, noindex: false, canonical: null });
  }
  for (const path of sitemapRes.paths) {
    const existing = byPath.get(path);
    if (existing) {
      existing.inSitemapXml = true;
      existing.source = "both";
    } else byPath.set(path, { path, source: "sitemap", sitemapFlag: null, inSitemapXml: true, status: 0, redirectTo: null, noindex: false, canonical: null });
  }
  // Static pages first (they matter most), then sitemap-only URLs, up to the cap.
  const ordered = [...byPath.values()].sort((a, b) => (a.source === "sitemap" ? 1 : 0) - (b.source === "sitemap" ? 1 : 0) || a.path.localeCompare(b.path));
  const toCheck = ordered.slice(0, FETCH_CAP);
  const results = await mapLimit(toCheck, CONCURRENCY, (p) => checkPage(baseUrl, p.path));
  toCheck.forEach((p, i) => Object.assign(p, results[i]));

  return {
    checkedAt: new Date().toISOString(),
    baseUrl,
    robots,
    sitemap: { status: sitemapRes.status, urls: sitemapRes.paths.length, indexes: sitemapRes.indexes },
    pages: toCheck,
    truncated: ordered.length > FETCH_CAP,
    errors,
  };
}

// ---- findings ----------------------------------------------------------------------

const isGone = (p: InventoryPage) => p.status === 404 || p.status === 410 || p.status === 0;
const isRedirect = (p: InventoryPage) => p.status >= 300 && p.status < 400;
const sameIgnoringSlash = (a: string, b: string | null, host: string) => {
  if (!b) return false;
  const bp = b.startsWith("/") ? normalizePath(b) : pathOfUrl(b, host);
  return bp === a;
};

export function inventoryFindings(inv: Inventory, previous: Inventory | null): { findings: FindingDraft[]; summary: InventorySummary } {
  const findings: FindingDraft[] = [];
  const host = new URL(inv.baseUrl).host;
  const push = (f: Omit<FindingDraft, "category" | "confidence"> & { confidence?: FindingDraft["confidence"] }) => findings.push({ category: "seo", confidence: "high", ...f });

  if (inv.robots.status !== 200) {
    push({ checkId: "seo.robots-missing", severity: "low", effort: "quick", title: "robots.txt missing", detail: `${inv.baseUrl}/robots.txt answered ${inv.robots.status || "nothing"}. Webflow serves one automatically unless custom robots rules are set; a missing file is unusual.`, data: { evidence: [`GET /robots.txt → ${inv.robots.status || "failed"}`] } });
  } else if (inv.robots.blocksAll) {
    push({ checkId: "seo.robots-blocks-all", severity: "critical", effort: "quick", title: "robots.txt blocks all crawling", detail: "The production domain disallows / for every user agent, so search engines and AI assistants cannot read the site. Usually a staging setting that went live.", data: { evidence: inv.robots.sample.split("\n").slice(0, 12) } });
  }
  if (inv.sitemap.status !== 200 || inv.sitemap.urls === 0) {
    push({ checkId: "seo.sitemap-missing", severity: "high", effort: "quick", title: "sitemap.xml missing or empty", detail: `${inv.baseUrl}/sitemap.xml answered ${inv.sitemap.status || "nothing"}${inv.sitemap.status === 200 ? " with no URLs" : ""}. Turn on the auto-generated sitemap in Webflow's SEO settings.`, data: { evidence: [`GET /sitemap.xml → ${inv.sitemap.status || "failed"}, ${inv.sitemap.urls} URLs`] } });
  }

  for (const p of inv.pages) {
    const ev = [`GET ${p.path} → ${p.status || "failed"}${p.redirectTo ? ` → ${p.redirectTo}` : ""}`];
    if (p.inSitemapXml && isGone(p)) {
      push({ checkId: "seo.sitemap-url-broken", severity: "high", effort: "quick", title: `Sitemap lists a page that returns ${p.status || "an error"}`, detail: "Search engines are sent to a dead URL. Remove it from the sitemap (unpublish or exclude the page) or restore the page.", pagePath: p.path, webflowPageId: p.webflowPageId, subject: p.path, data: { evidence: ev } });
    } else if (p.inSitemapXml && isRedirect(p) && !sameIgnoringSlash(p.path, p.redirectTo, host)) {
      push({ checkId: "seo.sitemap-url-redirects", severity: "low", effort: "quick", title: "Sitemap URL redirects", detail: `The sitemap should list final URLs; this one redirects to ${p.redirectTo}.`, pagePath: p.path, webflowPageId: p.webflowPageId, subject: p.path, data: { evidence: ev } });
    } else if (p.source !== "sitemap" && isGone(p)) {
      push({ checkId: "seo.published-page-404", severity: "high", effort: "moderate", title: `Published page returns ${p.status || "an error"}`, detail: `Webflow lists "${p.title ?? p.path}" as a published page, but the live URL does not serve it. Publish the site, or check the custom domain and page slug.`, pagePath: p.path, webflowPageId: p.webflowPageId, subject: p.path, data: { evidence: ev } });
    }
    if (p.inSitemapXml && p.status === 200 && p.noindex) {
      push({ checkId: "seo.page-noindex-in-sitemap", severity: "medium", effort: "quick", title: "Page is noindex but listed in the sitemap", detail: "The sitemap asks search engines to index a page that tells them not to. Either remove the noindex or exclude the page from the sitemap.", pagePath: p.path, webflowPageId: p.webflowPageId, subject: p.path, data: { evidence: ["meta robots / X-Robots-Tag contains noindex", ...ev] } });
    }
    if (p.source !== "sitemap" && p.status === 200 && !p.noindex && p.sitemapFlag === false && inv.sitemap.status === 200) {
      push({ checkId: "seo.excluded-from-sitemap", severity: "low", effort: "quick", title: "Indexable page excluded from the sitemap", detail: `"${p.title ?? p.path}" is published and indexable but its sitemap setting is off, so search engines may take longer to find it.`, pagePath: p.path, webflowPageId: p.webflowPageId, subject: p.path, data: { evidence: ["Webflow includeInSitemap = false", ...ev] } });
    }
    if (p.status === 200 && p.canonical) {
      const canonHost = (() => {
        try {
          return new URL(p.canonical, inv.baseUrl).host;
        } catch {
          return null;
        }
      })();
      if (canonHost && canonHost.replace(/^www\./, "") !== host.replace(/^www\./, "")) {
        push({ checkId: "seo.canonical-other-host", severity: "high", effort: "quick", title: "Canonical points to another domain", detail: `The page tells search engines the real copy lives at ${p.canonical}. If that is a staging or old domain, this page will not rank on its own.`, pagePath: p.path, webflowPageId: p.webflowPageId, subject: p.path, data: { evidence: [`<link rel="canonical" href="${p.canonical}">`] } });
      }
    }
  }

  let changes: InventorySummary["changes"] = null;
  if (previous) {
    const prevBy = new Map(previous.pages.map((p) => [p.path, p]));
    const nowBy = new Map(inv.pages.map((p) => [p.path, p]));
    let gone = 0;
    let redirected = 0;
    let noindexed = 0;
    for (const [path, prev] of prevBy) {
      if (prev.status !== 200) continue;
      const now = nowBy.get(path);
      if (!now) continue; // not checked this time (cap or dropped from both sources): not evidence of loss
      const ev = [`previous audit: 200${prev.noindex ? " (noindex)" : ""}`, `now: ${now.status || "failed"}${now.redirectTo ? ` → ${now.redirectTo}` : ""}${now.noindex ? " (noindex)" : ""}`];
      if (isGone(now)) {
        gone++;
        push({ checkId: "seo.migration-page-gone", severity: "high", effort: "moderate", title: `Page disappeared since the last audit (${now.status || "no response"})`, detail: `"${prev.title ?? path}" served fine at the last audit and now returns ${now.status || "nothing"}. Rankings and links to it are lost unless it is restored or redirected to its replacement.`, pagePath: path, webflowPageId: now.webflowPageId ?? prev.webflowPageId, subject: path, data: { evidence: ev } });
      } else if (isRedirect(now) && !sameIgnoringSlash(path, now.redirectTo, host)) {
        redirected++;
        push({ checkId: "seo.migration-page-redirects", severity: "medium", effort: "quick", title: "Page started redirecting since the last audit", detail: `${path} now redirects to ${now.redirectTo}. Fine if the move was intended; update internal links and the sitemap to the new URL.`, pagePath: path, webflowPageId: now.webflowPageId ?? prev.webflowPageId, subject: path, data: { evidence: ev } });
      } else if (now.status === 200 && now.noindex && !prev.noindex) {
        noindexed++;
        push({ checkId: "seo.migration-page-noindex", severity: "high", effort: "quick", title: "Page became noindex since the last audit", detail: `${path} was indexable at the last audit and now carries noindex. It will drop out of search results unless this is intended.`, pagePath: path, webflowPageId: now.webflowPageId ?? prev.webflowPageId, subject: path, data: { evidence: ev } });
      }
    }
    const sitemapDelta = inv.sitemap.urls - previous.sitemap.urls;
    if (previous.sitemap.urls >= 5 && inv.sitemap.status === 200 && inv.sitemap.urls < previous.sitemap.urls * 0.7) {
      const missing = previous.pages.filter((p) => p.inSitemapXml && !nowBy.get(p.path)?.inSitemapXml).map((p) => p.path);
      push({ checkId: "seo.migration-sitemap-shrunk", severity: "medium", effort: "quick", title: `Sitemap lost ${previous.sitemap.urls - inv.sitemap.urls} URLs since the last audit`, detail: `sitemap.xml listed ${previous.sitemap.urls} URLs at the last audit and ${inv.sitemap.urls} now. Pages unpublished or excluded in bulk, or a CMS collection switched off: check that it was intended.`, data: { evidence: missing.slice(0, 20) } });
    }
    changes = { gone, redirected, noindexed, sitemapDelta };
  }

  const summary: InventorySummary = {
    pages: inv.pages.length,
    ok: inv.pages.filter((p) => p.status === 200).length,
    redirects: inv.pages.filter(isRedirect).length,
    broken: inv.pages.filter(isGone).length,
    noindex: inv.pages.filter((p) => p.noindex).length,
    sitemapUrls: inv.sitemap.urls,
    robotsOk: inv.robots.status === 200 && !inv.robots.blocksAll,
    sitemapOk: inv.sitemap.status === 200 && inv.sitemap.urls > 0,
    changes,
  };
  return { findings, summary };
}

// A few lines for the agent's task prompt, so it does not redo these checks.
export function inventoryText(summary: InventorySummary, inv: Inventory): string {
  const lines = [
    `${summary.pages} URLs checked (${inv.pages.filter((p) => p.source !== "sitemap").length} published Webflow pages, ${summary.sitemapUrls} sitemap URLs${inv.truncated ? ", capped" : ""}): ${summary.ok} serve 200, ${summary.redirects} redirect, ${summary.broken} broken, ${summary.noindex} noindex.`,
    `robots.txt: ${summary.robotsOk ? "present, does not block crawling" : inv.robots.blocksAll ? "BLOCKS ALL CRAWLING" : "missing"}. sitemap.xml: ${summary.sitemapOk ? "present" : "missing or empty"}.`,
  ];
  if (summary.changes) lines.push(`Since the last audit: ${summary.changes.gone} page(s) gone, ${summary.changes.redirected} now redirect, ${summary.changes.noindexed} became noindex, sitemap ${summary.changes.sitemapDelta >= 0 ? "+" : ""}${summary.changes.sitemapDelta} URLs.`);
  const broken = inv.pages.filter(isGone).slice(0, 10).map((p) => `${p.path} (${p.status || "failed"})`);
  if (broken.length) lines.push(`Broken: ${broken.join(", ")}.`);
  return lines.join("\n");
}
