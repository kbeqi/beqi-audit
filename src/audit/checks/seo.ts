import type { AnalysisInput, FindingDraft } from "../types";

const TITLE_MAX = 60;
const DESC_MAX = 160;
const DESC_MIN = 50;

export function seoChecks(input: AnalysisInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const { crawl, webflow } = input;
  const pages = crawl.pages.filter((p) => p.status === 200 && p.contentType?.includes("text/html"));
  const pageByPath = new Map(pages.map((p) => [p.path, p]));

  // Site-level
  if (crawl.sitemap.status !== 200) {
    out.push({ category: "seo", checkId: "seo.sitemap-missing", severity: "high", title: "sitemap.xml is missing or not reachable", detail: `GET /sitemap.xml returned ${crawl.sitemap.status}. Enable the auto-generated sitemap in Webflow site settings (SEO tab).` });
  }
  if (crawl.robotsTxt.status !== 200) {
    out.push({ category: "seo", checkId: "seo.robots-missing", severity: "medium", title: "robots.txt is missing or not reachable", detail: `GET /robots.txt returned ${crawl.robotsTxt.status}.` });
  } else if (/^\s*user-agent:\s*\*\s*\n\s*disallow:\s*\/\s*$/im.test(crawl.robotsTxt.body ?? "")) {
    out.push({ category: "seo", checkId: "seo.robots-blocks-all", severity: "critical", title: "robots.txt disallows the whole site for all crawlers", detail: "A `Disallow: /` under `User-agent: *` keeps the site out of search engines." });
  }

  // Sitemap entries that do not resolve
  const crawledByUrl = new Map(crawl.pages.map((p) => [stripSlash(p.url), p]));
  for (const u of crawl.sitemap.urls) {
    const p = crawledByUrl.get(stripSlash(u));
    if (!p || p.status === 0) continue;
    if (p.redirected) {
      out.push({ category: "seo", checkId: "seo.sitemap-url-redirects", severity: "low", title: "Sitemap lists a URL that redirects", pagePath: p.path, subject: u, detail: `${u} → ${p.finalUrl}` });
    } else if (p.status !== 200) {
      out.push({ category: "seo", checkId: "seo.sitemap-url-broken", severity: "high", title: `Sitemap lists a page that returns ${p.status}`, pagePath: p.path, subject: u, detail: u });
    }
  }

  // Duplicate titles / descriptions
  const byTitle = groupBy(pages.filter((p) => p.title), (p) => p.title!.toLowerCase());
  for (const [title, group] of byTitle) {
    if (group.length > 1) {
      out.push({ category: "seo", checkId: "seo.duplicate-title", severity: "medium", title: `${group.length} pages share the title "${truncate(title, 60)}"`, subject: title, data: { pages: group.map((p) => p.path) } });
    }
  }
  const byDesc = groupBy(pages.filter((p) => p.metaDescription), (p) => p.metaDescription!.toLowerCase());
  for (const [desc, group] of byDesc) {
    if (group.length > 1) {
      out.push({ category: "seo", checkId: "seo.duplicate-description", severity: "low", title: `${group.length} pages share the same meta description`, subject: desc.slice(0, 80), data: { pages: group.map((p) => p.path) } });
    }
  }

  // Page-level
  for (const p of pages) {
    const ref = { pagePath: p.path, webflowPageId: webflowPageIdFor(p.path, webflow) };
    if (!p.title) out.push({ category: "seo", checkId: "seo.title-missing", severity: "high", title: "Page has no <title>", ...ref });
    else if (p.title.length > TITLE_MAX) out.push({ category: "seo", checkId: "seo.title-long", severity: "low", title: `Title is ${p.title.length} characters (over ${TITLE_MAX})`, detail: p.title, ...ref });

    if (!p.metaDescription) out.push({ category: "seo", checkId: "seo.description-missing", severity: "medium", title: "Page has no meta description", ...ref });
    else if (p.metaDescription.length > DESC_MAX) out.push({ category: "seo", checkId: "seo.description-long", severity: "low", title: `Meta description is ${p.metaDescription.length} characters (over ${DESC_MAX})`, detail: p.metaDescription, ...ref });
    else if (p.metaDescription.length < DESC_MIN) out.push({ category: "seo", checkId: "seo.description-short", severity: "info", title: `Meta description is only ${p.metaDescription.length} characters`, detail: p.metaDescription, ...ref });

    const h1s = p.headings.filter((h) => h.level === 1);
    if (h1s.length === 0) out.push({ category: "seo", checkId: "seo.h1-missing", severity: "medium", title: "Page has no H1", ...ref });
    else if (h1s.length > 1) out.push({ category: "seo", checkId: "seo.h1-multiple", severity: "low", title: `Page has ${h1s.length} H1 headings`, data: { h1s: h1s.map((h) => h.text) }, ...ref });

    const skips = headingSkips(p.headings.map((h) => h.level));
    if (skips > 0) out.push({ category: "seo", checkId: "seo.heading-skip", severity: "info", title: `Heading levels skip ${skips} time${skips > 1 ? "s" : ""} (e.g. H2 to H4)`, ...ref });

    const noAlt = p.images.filter((i) => i.alt === null || i.alt.trim() === "");
    if (noAlt.length > 0) {
      out.push({ category: "seo", checkId: "seo.img-alt-missing", severity: noAlt.length > 5 ? "medium" : "low", title: `${noAlt.length} of ${p.images.length} images have no alt text`, data: { images: noAlt.slice(0, 20).map((i) => i.src) }, ...ref });
    }

    if (!p.canonical) out.push({ category: "seo", checkId: "seo.canonical-missing", severity: "low", title: "Page has no canonical link", ...ref });
    else if (stripSlash(p.canonical) !== stripSlash(p.finalUrl)) out.push({ category: "seo", checkId: "seo.canonical-mismatch", severity: "medium", title: "Canonical points to a different URL", detail: p.canonical, ...ref });

    const inSitemap = crawl.sitemap.urls.some((u) => stripSlash(u) === stripSlash(p.url));
    if (p.metaRobots && /noindex/i.test(p.metaRobots)) {
      out.push({ category: "seo", checkId: "seo.noindex", severity: inSitemap ? "high" : "info", title: inSitemap ? "Page is noindex but listed in the sitemap" : "Page is set to noindex", detail: p.metaRobots, ...ref });
    }

    if (!p.og.title && !p.og.image) out.push({ category: "seo", checkId: "seo.og-missing", severity: "low", title: "No Open Graph tags (title/image) for link previews", ...ref });
    else if (!p.og.image) out.push({ category: "seo", checkId: "seo.og-image-missing", severity: "info", title: "No og:image for link previews", ...ref });

    if (p.wordCount < 80 && !p.path.match(/^\/(401|404|password|search)/)) {
      out.push({ category: "seo", checkId: "seo.thin-content", severity: "info", title: `Thin page: about ${p.wordCount} words`, ...ref });
    }
    if (!p.lang) out.push({ category: "seo", checkId: "seo.lang-missing", severity: "info", title: "<html> has no lang attribute", ...ref });
  }

  // Orphan pages: crawled (from sitemap/Webflow) but no internal link points to them.
  const linkedPaths = new Set<string>();
  for (const p of pages) for (const l of p.links) {
    try {
      const u = new URL(l.href);
      if (u.host === crawl.host) linkedPaths.add(stripSlash(u.pathname) || "/");
    } catch {
      /* ignore */
    }
  }
  for (const p of pages) {
    if (p.path === "/" ) continue;
    if (!linkedPaths.has(stripSlash(p.path))) {
      out.push({ category: "seo", checkId: "seo.orphan-page", severity: "low", title: "No internal link points to this page", pagePath: p.path, webflowPageId: webflowPageIdFor(p.path, webflow) });
    }
  }

  // Webflow-side: published static pages with empty SEO fields in the Designer.
  for (const wp of webflow.pages) {
    if (wp.draft || wp.archived || wp.collectionId) continue;
    const path = wp.publishedPath ?? `/${wp.slug}`;
    if (!pageByPath.has(path)) continue;
    if (!wp.seo?.title && !wp.seo?.description) {
      out.push({ category: "seo", checkId: "seo.webflow-seo-fields-empty", severity: "info", title: "SEO title and description are empty in Webflow page settings", detail: "The page may still render a title from its name, but the fields are not set explicitly.", pagePath: path, webflowPageId: wp.id });
    }
  }

  return out;
}

export function webflowPageIdFor(path: string, webflow: AnalysisInput["webflow"]): string | undefined {
  const norm = stripSlash(path) || "/";
  return webflow.pages.find((p) => stripSlash(p.publishedPath ?? `/${p.slug}`) === norm)?.id;
}

function headingSkips(levels: number[]): number {
  let skips = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips++;
  return skips;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

export function stripSlash(s: string): string {
  return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
