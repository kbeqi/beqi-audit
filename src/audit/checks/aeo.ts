import type { AnalysisInput, FindingDraft } from "../types";
import { webflowPageIdFor } from "./seo";

// AI crawlers whose access decides whether answer engines can read and cite the site.
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "anthropic-ai", "Claude-Web", "PerplexityBot", "Google-Extended", "CCBot", "Bytespider", "Amazonbot", "Applebot-Extended"];

export function aeoChecks(input: AnalysisInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const { crawl, webflow } = input;
  const pages = crawl.pages.filter((p) => p.status === 200 && p.contentType?.includes("text/html"));

  if (crawl.llmsTxt.status !== 200) {
    out.push({ category: "aeo", checkId: "aeo.llms-txt-missing", severity: "low", title: "No /llms.txt file", detail: "An llms.txt at the site root gives answer engines a curated map of the site. Adoption is still low, so this is a cheap win rather than a ranking factor." });
  }

  const robots = crawl.robotsTxt.body;
  if (robots) {
    const blocked = AI_BOTS.filter((bot) => isDisallowedAll(robots, bot));
    if (blocked.length > 0) {
      out.push({ category: "aeo", checkId: "aeo.ai-crawlers-blocked", severity: "medium", title: `robots.txt blocks ${blocked.length} AI crawler${blocked.length > 1 ? "s" : ""}`, detail: `Blocked: ${blocked.join(", ")}. Blocking training bots is a choice, but blocking search/answer bots (OAI-SearchBot, PerplexityBot, ClaudeBot) removes the site from AI answers.`, data: { blocked } });
    }
  }

  const home = pages.find((p) => p.path === "/" || p.path === "");
  if (home) {
    const types = new Set(home.jsonLd.flatMap((j) => j.types));
    if (!types.has("Organization") && !types.has("LocalBusiness") && !types.has("Corporation")) {
      out.push({ category: "aeo", checkId: "aeo.schema-organization-missing", severity: "medium", title: "Home page has no Organization schema", detail: "Organization (name, url, logo, sameAs) is the entity anchor answer engines use to identify the brand.", pagePath: home.path, webflowPageId: webflowPageIdFor(home.path, webflow) });
    }
    if (!types.has("WebSite")) {
      out.push({ category: "aeo", checkId: "aeo.schema-website-missing", severity: "low", title: "Home page has no WebSite schema", pagePath: home.path, webflowPageId: webflowPageIdFor(home.path, webflow) });
    }
  }

  let pagesWithoutSchema = 0;
  for (const p of pages) {
    const ref = { pagePath: p.path, webflowPageId: webflowPageIdFor(p.path, webflow) };
    for (const j of p.jsonLd) {
      if (j.error) out.push({ category: "aeo", checkId: "aeo.schema-invalid-json", severity: "high", title: "JSON-LD block is not valid JSON", detail: j.error, subject: j.raw.slice(0, 40), ...ref });
    }
    if (p.jsonLd.length === 0) pagesWithoutSchema++;

    const types = new Set(p.jsonLd.flatMap((j) => j.types));
    if (p.hasFaqHeading && !types.has("FAQPage")) {
      out.push({ category: "aeo", checkId: "aeo.faq-without-schema", severity: "low", title: "Page has an FAQ section but no FAQPage schema", ...ref });
    }
    const looksLikeArticle = /\/(blog|post|posts|news|articles?|insights|resources)\//i.test(p.path);
    if (looksLikeArticle && !types.has("Article") && !types.has("BlogPosting") && !types.has("NewsArticle")) {
      out.push({ category: "aeo", checkId: "aeo.article-without-schema", severity: "low", title: "Article-like page has no Article/BlogPosting schema", detail: "Add author, datePublished and dateModified so engines can judge freshness and authorship.", ...ref });
    }
    // Answer-first structure: first H2 should arrive early; long pages with one heading read badly to LLMs.
    if (p.wordCount > 600 && p.headings.filter((h) => h.level >= 2).length < 2) {
      out.push({ category: "aeo", checkId: "aeo.unstructured-long-page", severity: "info", title: `Long page (${p.wordCount} words) with fewer than two subheadings`, detail: "Answer engines extract from clearly sectioned content; add question-style H2s.", ...ref });
    }
  }
  if (pages.length > 0 && pagesWithoutSchema / pages.length > 0.5) {
    out.push({ category: "aeo", checkId: "aeo.schema-coverage-low", severity: "medium", title: `${pagesWithoutSchema} of ${pages.length} pages have no structured data`, detail: "Webflow pages accept JSON-LD in page settings; the audit app can bulk-write page schema via the Data API once a proposal is approved." });
  }

  return out;
}

// True when a `User-agent: <bot>` group contains `Disallow: /` (whole site).
function isDisallowedAll(robots: string, bot: string): boolean {
  const lines = robots.split(/\r?\n/).map((l) => l.trim());
  let inGroup = false;
  for (const line of lines) {
    const ua = /^user-agent:\s*(.+)$/i.exec(line);
    if (ua) {
      inGroup = ua[1].trim().toLowerCase() === bot.toLowerCase();
      continue;
    }
    if (!inGroup) continue;
    if (/^disallow:\s*\/\s*$/i.test(line)) return true;
    if (line === "") inGroup = false;
  }
  return false;
}
