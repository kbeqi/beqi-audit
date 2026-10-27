import { extractCssClasses, parseHtml, emptyPageFields } from "./html";
import type { CrawlResult, CrawledPage } from "./types";

const UA = "BeqiAuditBot/1.0 (+https://beqi.co; site audit for a Webflow client)";
const FETCH_TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

export interface CrawlOptions {
  baseUrl: string;
  // Paths known from Webflow (publishedPath of static pages); seeded before link discovery.
  seedPaths: string[];
  maxPages: number;
}

export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const base = new URL(opts.baseUrl);
  const host = base.host;
  const startedAt = new Date().toISOString();

  const [robots, llms, sitemap] = await Promise.all([
    fetchText(new URL("/robots.txt", base).toString()),
    fetchHead(new URL("/llms.txt", base).toString()),
    fetchSitemap(new URL("/sitemap.xml", base).toString(), host),
  ]);

  const queue: string[] = [];
  const seen = new Set<string>();
  const enqueue = (u: string) => {
    const norm = normalizeUrl(u, host);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    queue.push(norm);
  };

  enqueue(base.toString());
  for (const p of opts.seedPaths) enqueue(new URL(p, base).toString());
  for (const u of sitemap.urls) enqueue(u);

  const pages: CrawledPage[] = [];
  let truncated = false;

  while (queue.length > 0 && pages.length < opts.maxPages) {
    const batch = queue.splice(0, Math.min(CONCURRENCY, opts.maxPages - pages.length));
    const results = await Promise.all(batch.map((u) => fetchPage(u, host)));
    for (const page of results) {
      pages.push(page);
      for (const link of page.links) {
        if (isInternalHtmlLink(link.href, host)) enqueue(link.href);
      }
    }
  }
  if (queue.length > 0) truncated = true;

  // Classes defined by the site's own stylesheets (Webflow emits one per site).
  const stylesheetUrls = new Set<string>();
  for (const p of pages) for (const s of p.stylesheets) if (sameHostOrWebflowCss(s, host)) stylesheetUrls.add(s);
  const stylesheetClasses: Record<string, string[]> = {};
  for (const url of [...stylesheetUrls].slice(0, 5)) {
    const css = await fetchText(url);
    if (css.body) stylesheetClasses[url] = extractCssClasses(css.body);
  }

  return {
    baseUrl: base.toString(),
    host,
    startedAt,
    finishedAt: new Date().toISOString(),
    pages,
    robotsTxt: robots,
    llmsTxt: { status: llms },
    sitemap,
    stylesheetClasses,
    truncated,
  };
}

async function fetchPage(url: string, host: string): Promise<CrawledPage> {
  const t0 = Date.now();
  const path = new URL(url).pathname;
  const baseFields = {
    url,
    path,
    status: 0,
    finalUrl: url,
    redirected: false,
    contentType: null as string | null,
    fetchMs: 0,
    htmlBytes: 0,
  };
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type");
    const finalUrl = res.url || url;
    const redirected = res.redirected || normalizeUrl(finalUrl, host) !== normalizeUrl(url, host);
    if (redirected && normalizeUrl(finalUrl, host)) {
      // Internal redirect: the destination is crawled under its own URL; record
      // this one as a redirect so its content is not counted twice.
      await res.body?.cancel();
      const page: CrawledPage = { ...baseFields, ...emptyPageFields(), status: 301, finalUrl, redirected: true, contentType, fetchMs: Date.now() - t0 };
      page.links = [{ href: finalUrl, text: "" }];
      return page;
    }
    if (!contentType || !contentType.includes("text/html")) {
      await res.body?.cancel();
      return { ...baseFields, ...emptyPageFields(), status: res.status, finalUrl, redirected, contentType, fetchMs: Date.now() - t0 };
    }
    const html = await res.text();
    const parsed = parseHtml(html, finalUrl);
    return {
      ...baseFields,
      ...parsed,
      status: res.status,
      finalUrl,
      redirected,
      contentType,
      fetchMs: Date.now() - t0,
      htmlBytes: html.length,
    };
  } catch (e) {
    return { ...baseFields, ...emptyPageFields(), fetchMs: Date.now() - t0, error: (e as Error).message };
  }
}

async function fetchText(url: string): Promise<{ status: number; body: string | null }> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = res.ok ? await res.text() : null;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

async function fetchHead(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "GET", headers: { "user-agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

async function fetchSitemap(url: string, host: string): Promise<{ status: number; urls: string[] }> {
  const { status, body } = await fetchText(url);
  if (!body) return { status, urls: [] };
  const urls = new Set<string>();
  const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  // Sitemap index: follow child sitemaps (one level).
  const children = locs.filter((l) => /sitemap[^/]*\.xml$/i.test(l));
  for (const l of locs) if (!children.includes(l)) urls.add(l);
  for (const child of children.slice(0, 10)) {
    const c = await fetchText(child);
    if (!c.body) continue;
    for (const m of c.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) urls.add(m[1]);
  }
  return { status, urls: [...urls].filter((u) => safeHost(u) === host) };
}

export function normalizeUrl(u: string, host: string): string | null {
  try {
    const url = new URL(u);
    if (url.host !== host) return null;
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    // Strip trailing slash except root.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function isInternalHtmlLink(href: string, host: string): boolean {
  try {
    const url = new URL(href);
    if (url.host !== host) return false;
    if (!/^https?:$/.test(url.protocol)) return false;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|avif|mp4|webm|zip|css|js|xml|json|ico|woff2?)$/i.test(url.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function sameHostOrWebflowCss(url: string, host: string): boolean {
  const h = safeHost(url);
  return h === host || /\.webflow\.css$/i.test(url) || /website-files\.com/i.test(url);
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}
