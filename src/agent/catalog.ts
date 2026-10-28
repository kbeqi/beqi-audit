// The fixed catalog of checks the audit may report. Ids are stable across runs
// (a finding's fingerprint is built from its check id), so rename with care:
// renaming an id resets that finding's lifecycle on every site.
//
// Each check names the automated fix action that can address it, or `null`
// when the fix needs a human in the Designer. Checks marked `deterministic`
// are produced by code (PageSpeed, the AI sample), not by the audit agent.

import type { CategoryKey, Severity } from "@/db/schema";

export const FIX_ACTIONS = [
  "page_seo", // title / meta description / Open Graph via page settings
  "schema_markup", // JSON-LD on a page
  "sitemap_flag", // include/exclude a page from the generated sitemap
  "alt_text", // alt text on an asset or image element
  "heading_level", // change a heading element's level (h1..h6)
  "custom_code", // site or page head/footer code
  "remove_script", // remove an applied registered script
  "image_compress", // convert image assets to webp/avif
  "manual", // no safe automated fix; explain what to do in the Designer
] as const;
export type FixAction = (typeof FIX_ACTIONS)[number];

export const CHECK_IDS = [
  // SEO
  "seo.title-missing",
  "seo.title-long",
  "seo.description-missing",
  "seo.description-long",
  "seo.description-short",
  "seo.duplicate-title",
  "seo.duplicate-description",
  "seo.h1-missing",
  "seo.h1-multiple",
  "seo.heading-skip",
  "seo.img-alt-missing",
  "seo.canonical-missing",
  "seo.canonical-mismatch",
  "seo.noindex",
  "seo.og-missing",
  "seo.og-image-missing",
  "seo.thin-content",
  "seo.lang-missing",
  "seo.orphan-page",
  "seo.webflow-seo-fields-empty",
  "seo.sitemap-missing",
  "seo.robots-missing",
  "seo.robots-blocks-all",
  "seo.sitemap-url-broken",
  "seo.sitemap-url-redirects",
  "seo.excluded-from-sitemap",
  "seo.staging-domain-indexable",
  // AEO / GEO: crawler access, structured data, answer-usefulness
  "aeo.ai-search-crawlers-blocked",
  "aeo.ai-user-fetchers-blocked",
  "aeo.ai-training-crawlers-blocked",
  "aeo.llms-txt-missing",
  "aeo.schema-organization-missing",
  "aeo.schema-website-missing",
  "aeo.schema-invalid-json",
  "aeo.faq-without-schema",
  "aeo.article-without-schema",
  "aeo.schema-coverage-low",
  "aeo.answer-not-explicit",
  "aeo.heading-not-descriptive",
  "aeo.paragraph-not-self-contained",
  "aeo.missing-date-or-scope",
  "aeo.key-info-only-in-images",
  "aeo.unstructured-long-page",
  // Performance: agent-observed
  "perf.images-unoptimized",
  "perf.images-oversized",
  "perf.page-weight",
  "perf.render-blocking-scripts",
  "perf.many-third-party-scripts",
  // Performance: deterministic, from PageSpeed Insights
  "perf.lcp-poor",
  "perf.lcp-needs-work",
  "perf.inp-poor",
  "perf.inp-needs-work",
  "perf.cls-poor",
  "perf.cls-needs-work",
  "perf.score-poor",
  "perf.psi-unavailable",
  // Trust & identity
  "trust.organization-schema-incomplete",
  "trust.business-identity-inconsistent",
  "trust.no-contact-details",
  "trust.no-policies",
  "trust.article-missing-author",
  "trust.article-missing-date",
  "trust.claims-without-evidence",
  // Links
  "links.broken",
  "links.page-error-status",
  "links.page-fetch-failed",
  "links.internal-redirect",
  "links.redirect-chain",
  "links.insecure-http",
  "links.staging-domain",
  // Unused
  "unused.registered-script",
  "unused.duplicate-tracker",
  "unused.css-classes",
  // Naming
  "naming.auto-generated-on-page",
  "naming.auto-generated-site",
  // AI visibility: deterministic, from the sampled answers
  "ai.not-mentioned",
  "ai.not-cited",
  "ai.inaccurate-claim",
  "ai.sample-unavailable",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckDef {
  category: CategoryKey;
  title: string;
  // What to look at and when it counts as a finding. Written for the agent.
  what: string;
  severity: Severity;
  fix: FixAction | null;
  deterministic?: boolean;
}

export const CHECKS: Record<CheckId, CheckDef> = {
  "seo.title-missing": { category: "seo", title: "Page has no title", what: "Webflow SEO title and the rendered <title> are both empty.", severity: "high", fix: "page_seo" },
  "seo.title-long": { category: "seo", title: "Title longer than 60 characters", what: "Rendered <title> exceeds 60 characters and will be truncated in results.", severity: "low", fix: "page_seo" },
  "seo.description-missing": { category: "seo", title: "Meta description missing", what: "No meta description in page settings or rendered HTML.", severity: "medium", fix: "page_seo" },
  "seo.description-long": { category: "seo", title: "Meta description longer than 160 characters", what: "Meta description exceeds 160 characters.", severity: "low", fix: "page_seo" },
  "seo.description-short": { category: "seo", title: "Meta description shorter than 50 characters", what: "Meta description is present but under 50 characters.", severity: "low", fix: "page_seo" },
  "seo.duplicate-title": { category: "seo", title: "Duplicate title across pages", what: "Two or more indexable pages share the same title. Report once per duplicated title; list the pages in evidence.", severity: "medium", fix: "page_seo" },
  "seo.duplicate-description": { category: "seo", title: "Duplicate meta description across pages", what: "Two or more indexable pages share the same meta description.", severity: "low", fix: "page_seo" },
  "seo.h1-missing": { category: "seo", title: "No H1 on page", what: "Rendered page has no <h1>.", severity: "high", fix: "heading_level" },
  "seo.h1-multiple": { category: "seo", title: "More than one H1", what: "Rendered page has two or more <h1> elements.", severity: "medium", fix: "heading_level" },
  "seo.heading-skip": { category: "seo", title: "Heading levels skip", what: "Heading hierarchy jumps a level (e.g. h2 to h4).", severity: "low", fix: "heading_level" },
  "seo.img-alt-missing": { category: "seo", title: "Images without alt text", what: "Content images (not decorative) rendered without an alt attribute or with empty alt. One finding per page; list image URLs or asset ids in evidence.", severity: "medium", fix: "alt_text" },
  "seo.canonical-missing": { category: "seo", title: "Canonical tag missing", what: "Rendered page has no <link rel=canonical>.", severity: "low", fix: "manual" },
  "seo.canonical-mismatch": { category: "seo", title: "Canonical points elsewhere", what: "Canonical URL differs from the page's own URL (ignoring trailing slash). Distinguish a deliberate consolidation from a mistake.", severity: "medium", fix: "manual" },
  "seo.noindex": { category: "seo", title: "Page is noindex", what: "Meta robots or page settings exclude the page from indexing. Report as info if it looks intentional (thank-you, utility pages); high when a commercial page is excluded.", severity: "high", fix: "manual" },
  "seo.og-missing": { category: "seo", title: "Open Graph title/description missing", what: "Neither page settings nor rendered HTML provide og:title / og:description.", severity: "low", fix: "page_seo" },
  "seo.og-image-missing": { category: "seo", title: "Open Graph image missing", what: "No og:image on the page or inherited from site settings.", severity: "low", fix: "manual" },
  "seo.thin-content": { category: "seo", title: "Thin content", what: "Indexable page with under ~150 words of visible copy.", severity: "low", fix: "manual" },
  "seo.lang-missing": { category: "seo", title: "HTML lang attribute missing", what: "Rendered <html> has no lang attribute.", severity: "low", fix: "manual" },
  "seo.orphan-page": { category: "seo", title: "Orphan page", what: "Published, indexable page that no other reviewed page links to.", severity: "low", fix: "manual" },
  "seo.webflow-seo-fields-empty": { category: "seo", title: "Webflow SEO fields empty", what: "Page settings have empty SEO title and description even if the rendered page falls back to defaults.", severity: "medium", fix: "page_seo" },
  "seo.sitemap-missing": { category: "seo", title: "sitemap.xml missing", what: "/sitemap.xml returns non-200 or is empty.", severity: "high", fix: "manual" },
  "seo.robots-missing": { category: "seo", title: "robots.txt missing", what: "/robots.txt returns non-200.", severity: "low", fix: "manual" },
  "seo.robots-blocks-all": { category: "seo", title: "robots.txt blocks all crawling", what: "robots.txt disallows / for all user agents on the production domain.", severity: "critical", fix: "manual" },
  "seo.sitemap-url-broken": { category: "seo", title: "Sitemap URL returns an error", what: "A URL listed in sitemap.xml returns 4xx/5xx. One finding per URL (subject = URL).", severity: "high", fix: "sitemap_flag" },
  "seo.sitemap-url-redirects": { category: "seo", title: "Sitemap URL redirects", what: "A URL listed in sitemap.xml responds with a redirect.", severity: "low", fix: "manual" },
  "seo.excluded-from-sitemap": { category: "seo", title: "Indexable page excluded from sitemap", what: "Page is published and indexable but includeInSitemap is false.", severity: "low", fix: "sitemap_flag" },
  "seo.staging-domain-indexable": { category: "seo", title: "Staging domain is indexable", what: "The site has a custom domain, yet the webflow.io staging host serves pages without noindex (fetch the staging homepage and check meta robots / robots.txt). Duplicate indexing risk.", severity: "medium", fix: "manual" },

  "aeo.ai-search-crawlers-blocked": { category: "aeo", title: "AI search crawlers blocked", what: "robots.txt disallows crawlers that feed AI *search* answers: OAI-SearchBot, PerplexityBot, Claude-SearchBot, Bingbot (Copilot), Applebot. Blocking these removes the site from AI answers. List the blocked agents. Googlebot also serves AI Overviews; a Googlebot block belongs under seo.robots-blocks-all.", severity: "medium", fix: "manual" },
  "aeo.ai-user-fetchers-blocked": { category: "aeo", title: "AI user-triggered fetchers blocked", what: "robots.txt disallows fetchers that retrieve a page when a user asks about it: ChatGPT-User, Perplexity-User, Claude-User. Blocking them breaks 'read this page' and live lookups.", severity: "low", fix: "manual" },
  "aeo.ai-training-crawlers-blocked": { category: "aeo", title: "AI training crawlers blocked", what: "robots.txt disallows training crawlers: GPTBot, ClaudeBot, CCBot, Google-Extended, Bytespider, anthropic-ai. This is a legitimate policy choice and does not affect AI search visibility; report as info so the client knows the position they have taken.", severity: "info", fix: "manual" },
  "aeo.llms-txt-missing": { category: "aeo", title: "llms.txt not present", what: "/llms.txt returns non-200. Google states it ignores llms.txt for search and AI features, so this is informational: only worth adding if the client targets tools that read it.", severity: "info", fix: "manual" },
  "aeo.schema-organization-missing": { category: "aeo", title: "No Organization schema", what: "No JSON-LD of type Organization (or LocalBusiness) on the homepage.", severity: "medium", fix: "schema_markup" },
  "aeo.schema-website-missing": { category: "aeo", title: "No WebSite schema", what: "No JSON-LD of type WebSite on the homepage.", severity: "low", fix: "schema_markup" },
  "aeo.schema-invalid-json": { category: "aeo", title: "Invalid JSON-LD", what: "A JSON-LD block fails to parse or lacks @context/@type.", severity: "high", fix: "schema_markup" },
  "aeo.faq-without-schema": { category: "aeo", title: "FAQ content without FAQPage schema", what: "Page has a visible FAQ section but no FAQPage JSON-LD. Google no longer shows FAQ rich results (May 2026), so this is informational: the markup can still help other systems, and the visible answers matter more than the markup.", severity: "info", fix: "schema_markup" },
  "aeo.article-without-schema": { category: "aeo", title: "Article without Article schema", what: "Blog/article page (CMS template or long-form post) without Article/BlogPosting JSON-LD.", severity: "low", fix: "schema_markup" },
  "aeo.schema-coverage-low": { category: "aeo", title: "Low structured-data coverage", what: "Fewer than a third of reviewed pages carry any JSON-LD. Site-wide finding.", severity: "low", fix: "manual" },
  "aeo.answer-not-explicit": { category: "aeo", title: "Page doesn't state its answer plainly", what: "On a key page (home, service, product, pricing, FAQ, article) the main question a visitor has (what is this, who is it for, what does it cost, how does it work) is not answered in a clear sentence or two near the top; the reader must infer it from marketing copy. Quote the opening copy in evidence.", severity: "medium", fix: "manual" },
  "aeo.heading-not-descriptive": { category: "aeo", title: "Headings don't describe their sections", what: "Section headings are slogans or single words ('Why us', 'Simple', 'Hello') rather than descriptions of what follows, so a reader or an AI system can't tell what the section answers. List the headings.", severity: "low", fix: "manual" },
  "aeo.paragraph-not-self-contained": { category: "aeo", title: "Key paragraphs don't stand alone", what: "Important paragraphs rely on context that is only in an image, a previous section or the page title (pronouns without a subject, 'it', 'this plan') so an extracted passage would be meaningless. Quote an example.", severity: "low", fix: "manual" },
  "aeo.missing-date-or-scope": { category: "aeo", title: "No date or scope on time-sensitive content", what: "Pricing, comparisons, statistics, 'latest' claims or articles show no visible date, version or scope (region, plan), so a reader can't tell if they are current or who they apply to.", severity: "low", fix: "manual" },
  "aeo.key-info-only-in-images": { category: "aeo", title: "Key information only in images", what: "Prices, feature lists, steps, charts or contact details are presented only as images (no text equivalent), so they can't be read by search or AI systems.", severity: "medium", fix: "manual" },
  "aeo.unstructured-long-page": { category: "aeo", title: "Long page without subheadings", what: "Page over ~1500 words with fewer than 3 headings.", severity: "info", fix: "manual" },

  "perf.images-unoptimized": { category: "performance", title: "Images not in a modern format", what: "Site assets or rendered images served as PNG/JPEG where WebP/AVIF is available. One site-wide finding; list asset ids in evidence.", severity: "medium", fix: "image_compress" },
  "perf.images-oversized": { category: "performance", title: "Very large image files", what: "Individual image assets over 500 KB.", severity: "medium", fix: "manual" },
  "perf.page-weight": { category: "performance", title: "Heavy page HTML", what: "Rendered HTML of a page exceeds 300 KB.", severity: "medium", fix: "manual" },
  "perf.render-blocking-scripts": { category: "performance", title: "Render-blocking scripts in head", what: "External <script> tags in <head> without async/defer (excluding Webflow's own runtime).", severity: "medium", fix: "manual" },
  "perf.many-third-party-scripts": { category: "performance", title: "Many third-party scripts", what: "More than 8 distinct third-party script hosts on a page.", severity: "low", fix: "manual" },
  "perf.lcp-poor": { category: "performance", title: "Largest Contentful Paint is poor", what: "Measured by PageSpeed Insights (field data when available, else lab): LCP over 4.0 s on mobile.", severity: "high", fix: "manual", deterministic: true },
  "perf.lcp-needs-work": { category: "performance", title: "Largest Contentful Paint needs improvement", what: "LCP between 2.5 s and 4.0 s on mobile.", severity: "medium", fix: "manual", deterministic: true },
  "perf.inp-poor": { category: "performance", title: "Interaction to Next Paint is poor", what: "Field INP over 500 ms on mobile.", severity: "high", fix: "manual", deterministic: true },
  "perf.inp-needs-work": { category: "performance", title: "Interaction to Next Paint needs improvement", what: "Field INP between 200 ms and 500 ms on mobile.", severity: "medium", fix: "manual", deterministic: true },
  "perf.cls-poor": { category: "performance", title: "Cumulative Layout Shift is poor", what: "CLS over 0.25 on mobile.", severity: "high", fix: "manual", deterministic: true },
  "perf.cls-needs-work": { category: "performance", title: "Cumulative Layout Shift needs improvement", what: "CLS between 0.1 and 0.25 on mobile.", severity: "medium", fix: "manual", deterministic: true },
  "perf.score-poor": { category: "performance", title: "Lighthouse performance score under 50", what: "Mobile Lighthouse performance score below 50.", severity: "medium", fix: "manual", deterministic: true },
  "perf.psi-unavailable": { category: "performance", title: "PageSpeed data unavailable", what: "PageSpeed Insights could not measure the page in this run.", severity: "info", fix: "manual", deterministic: true },

  "trust.organization-schema-incomplete": { category: "trust", title: "Organization schema is incomplete", what: "The Organization/LocalBusiness JSON-LD lacks logo, url, sameAs (official social/profile links) or a contact point, or its name differs from the site's visible name.", severity: "medium", fix: "schema_markup" },
  "trust.business-identity-inconsistent": { category: "trust", title: "Business identity is inconsistent across the site", what: "Business name, legal name, address, phone or email differ between footer, contact page, about page and schema (e.g. two spellings of the name, two phone numbers). List the variants.", severity: "medium", fix: "manual" },
  "trust.no-contact-details": { category: "trust", title: "No way to contact the business", what: "No contact page, email, phone or physical address anywhere on the reviewed pages.", severity: "medium", fix: "manual" },
  "trust.no-policies": { category: "trust", title: "Privacy or terms pages missing", what: "No privacy policy (and, for sites that sell, no terms/refund policy) linked from the site.", severity: "low", fix: "manual" },
  "trust.article-missing-author": { category: "trust", title: "Articles have no author", what: "Blog or article pages show no author name or byline (visible or in schema). One finding per site with example pages.", severity: "low", fix: "manual" },
  "trust.article-missing-date": { category: "trust", title: "Articles have no visible date", what: "Blog or article pages show no publish or updated date. One finding per site with example pages.", severity: "low", fix: "manual" },
  "trust.claims-without-evidence": { category: "trust", title: "Strong claims without evidence", what: "Superlatives or numbers ('#1', 'trusted by 10,000', '99% faster', awards, certifications) with no source, logo, link or case study near them. Quote the claim.", severity: "low", fix: "manual" },

  "links.broken": { category: "links", title: "Broken link", what: "An internal or external link on a reviewed page returns 404/410 or fails. One finding per URL (subject = URL); list referring pages in evidence.", severity: "high", fix: "manual" },
  "links.page-error-status": { category: "links", title: "Published page returns an error", what: "A page from the Webflow page list returns 4xx/5xx on the live site.", severity: "high", fix: "manual" },
  "links.page-fetch-failed": { category: "links", title: "Page could not be fetched", what: "Fetching a published page timed out or failed at the network level.", severity: "medium", fix: "manual" },
  "links.internal-redirect": { category: "links", title: "Internal link redirects", what: "An internal link points at a URL that redirects (e.g. missing trailing slash, old slug).", severity: "low", fix: "manual" },
  "links.redirect-chain": { category: "links", title: "Redirect chain", what: "A URL redirects two or more times before resolving.", severity: "low", fix: "manual" },
  "links.insecure-http": { category: "links", title: "Insecure http:// link or asset", what: "A link or asset on a reviewed page uses http:// to a host that supports https.", severity: "medium", fix: "manual" },
  "links.staging-domain": { category: "links", title: "Link to the webflow.io staging domain", what: "A page on the custom domain links to *.webflow.io.", severity: "high", fix: "manual" },

  "unused.registered-script": { category: "unused", title: "Registered script not applied anywhere", what: "A registered script (data_scripts_tool) is applied to neither the site nor any page.", severity: "low", fix: "remove_script" },
  "unused.duplicate-tracker": { category: "unused", title: "Duplicate analytics tracker", what: "The same analytics/tag snippet (GA4, GTM, Meta Pixel, Hotjar...) appears twice on a page, e.g. in site code and page code.", severity: "medium", fix: "remove_script" },
  "unused.css-classes": { category: "unused", title: "Many unused classes", what: "Only when style data is available: a large share of site classes are not used by any element. Site-wide, info only.", severity: "info", fix: "manual" },

  "naming.auto-generated-on-page": { category: "naming", title: "Auto-generated class names on page", what: "Elements on a page use Webflow default names like 'Div Block 12', 'Section 3', 'Heading 7'. One finding per page; list a few names in evidence.", severity: "low", fix: "manual" },
  "naming.auto-generated-site": { category: "naming", title: "Auto-generated class names across the site", what: "Site styles include many default-named classes. Site-wide finding with the count.", severity: "low", fix: "manual" },

  "ai.not-mentioned": { category: "ai", title: "Rarely mentioned in AI answers", what: "In the sampled prompts, AI assistants mentioned the brand in fewer than half of the answers.", severity: "medium", fix: "manual", deterministic: true },
  "ai.not-cited": { category: "ai", title: "Site never cited by AI answers", what: "AI assistants mentioned the brand but never linked to the site as a source.", severity: "low", fix: "manual", deterministic: true },
  "ai.inaccurate-claim": { category: "ai", title: "AI answer states something wrong about the business", what: "A claim in a sampled answer contradicts the site's own stated facts (subject = the claim).", severity: "high", fix: "manual", deterministic: true },
  "ai.sample-unavailable": { category: "ai", title: "AI visibility sample not run", what: "No AI engine was available or every call failed.", severity: "info", fix: "manual", deterministic: true },
};

export const CATEGORY_OF: Record<CheckId, CategoryKey> = Object.fromEntries(
  (Object.keys(CHECKS) as CheckId[]).map((id) => [id, CHECKS[id].category]),
) as Record<CheckId, CategoryKey>;

export function isCheckId(id: string): id is CheckId {
  return Object.prototype.hasOwnProperty.call(CHECKS, id);
}

// The checks the agent itself reports (deterministic ones are produced by code).
export const AGENT_CHECK_IDS = CHECK_IDS.filter((id) => !CHECKS[id].deterministic) as CheckId[];

// Renders the agent's part of the catalog for the system prompt.
export function catalogText(): string {
  const byCategory = new Map<CategoryKey, CheckId[]>();
  for (const id of AGENT_CHECK_IDS) {
    const cat = CHECKS[id].category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(id);
  }
  const lines: string[] = [];
  for (const [cat, ids] of byCategory) {
    lines.push(`## ${cat}`);
    for (const id of ids) {
      const c = CHECKS[id];
      lines.push(`- ${id} [${c.severity}${c.fix && c.fix !== "manual" ? `, fix: ${c.fix}` : ""}] — ${c.title}. ${c.what}`);
    }
  }
  return lines.join("\n");
}
