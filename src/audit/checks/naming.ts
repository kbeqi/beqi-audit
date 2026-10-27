import type { AnalysisInput, FindingDraft } from "../types";
import { webflowPageIdFor } from "./seo";

// Webflow publishes class names lower-cased and hyphenated, so "Div Block 12"
// becomes "div-block-12". Names that still match the Designer's defaults are
// elements nobody named, which is the one convention the audit enforces in v1.
// Any default base name with a numeric suffix ("heading-4", "button-2") is
// unambiguous. Bare names count only where Webflow's default is rarely a
// deliberate choice ("div-block", "text-block"); bare "button", "navbar",
// "footer" and the like are common intentional names and are left alone.
const AUTO_BASE =
  "div-block|section|container|heading|text-block|paragraph|button|link-block|link|image|columns|column|list|list-item|grid|form-block|form|text-field|submit-button|rich-text-block|html-embed|code-embed|navbar|nav-menu|nav-link|dropdown|dropdown-toggle|dropdown-list|collection-list-wrapper|collection-list|collection-item|lightbox-link|video|background-video|slider|slide|tabs|tab-link|tab-pane|utility-page-wrap|block-quote|bold-text|italic-text|text-span|quick-stack|cell|body|footer|header|icon|field-label|checkbox|radio-button|select-field|textarea|search|search-input|search-button|table|table-cell|table-row";
const AUTO_BARE =
  "div-block|text-block|paragraph|link-block|columns|column|list-item|form-block|text-field|submit-button|rich-text-block|html-embed|code-embed|collection-list-wrapper|collection-list|collection-item|lightbox-link|background-video|tab-link|tab-pane|utility-page-wrap|block-quote|bold-text|italic-text|text-span|quick-stack|dropdown-toggle|dropdown-list|field-label|select-field|search-input|search-button|table-cell|table-row";

const AUTO_NUMBERED_RE = new RegExp(`^(${AUTO_BASE})-\\d+$`);
const AUTO_BARE_RE = new RegExp(`^(${AUTO_BARE})$`);
const AUTO_RE = { test: (c: string) => AUTO_NUMBERED_RE.test(c) || AUTO_BARE_RE.test(c) };

export function namingChecks(input: AnalysisInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const { crawl, webflow } = input;
  const pages = crawl.pages.filter((p) => p.status === 200 && p.contentType?.includes("text/html"));

  const allAuto = new Map<string, Set<string>>(); // class -> pages
  for (const p of pages) {
    const auto = p.classes.filter((c) => AUTO_RE.test(c));
    for (const c of auto) {
      if (!allAuto.has(c)) allAuto.set(c, new Set());
      allAuto.get(c)!.add(p.path);
    }
    if (auto.length >= 5) {
      out.push({
        category: "naming",
        checkId: "naming.auto-generated-on-page",
        severity: auto.length >= 15 ? "medium" : "low",
        title: `${auto.length} auto-generated class names on this page`,
        detail: auto.slice(0, 12).join(", ") + (auto.length > 12 ? ", …" : ""),
        data: { classes: auto },
        pagePath: p.path,
        webflowPageId: webflowPageIdFor(p.path, webflow),
      });
    }
  }

  // Also count defaults that exist in the stylesheet but are not on any crawled page.
  const defined = new Set<string>();
  for (const classes of Object.values(crawl.stylesheetClasses)) for (const c of classes) if (AUTO_RE.test(c)) defined.add(c);
  const total = new Set([...allAuto.keys(), ...defined]);

  if (total.size > 0) {
    const sorted = [...total].sort();
    const ratioOfDefined = Object.values(crawl.stylesheetClasses).flat().length;
    out.push({
      category: "naming",
      checkId: "naming.auto-generated-site",
      severity: total.size >= 40 ? "high" : total.size >= 15 ? "medium" : total.size >= 5 ? "low" : "info",
      title: `${total.size} auto-generated class names across the site (e.g. ${sorted.slice(0, 3).join(", ")})`,
      detail: `Default names like "Div Block 12" mean the element was never named. They make the Designer hard to navigate and are the main source of unused-style bloat.${ratioOfDefined ? ` The site stylesheet defines ${ratioOfDefined} classes in total.` : ""}`,
      data: { classes: sorted.slice(0, 400), pagesByClass: Object.fromEntries([...allAuto].slice(0, 200).map(([c, s]) => [c, [...s].slice(0, 10)])) },
    });
  }

  return out;
}
