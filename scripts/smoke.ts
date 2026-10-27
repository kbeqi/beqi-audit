// Runs the crawler, link checker and all checks against a public site without
// Webflow credentials or a database. Useful for tuning checks.
//   npm run smoke -- https://www.example.com [maxPages] [--psi]
import { crawlSite } from "../src/audit/crawl";
import { checkLinks } from "../src/audit/links";
import { runPsi } from "../src/audit/psi";
import { seoChecks } from "../src/audit/checks/seo";
import { aeoChecks } from "../src/audit/checks/aeo";
import { linkChecks } from "../src/audit/checks/links";
import { unusedChecks } from "../src/audit/checks/unused";
import { namingChecks } from "../src/audit/checks/naming";
import { performanceChecks } from "../src/audit/checks/performance";
import { scoreCategories } from "../src/audit/score";
import type { AnalysisInput, PsiResult } from "../src/audit/types";

async function main() {
  const [baseUrl, maxPagesArg, ...flags] = process.argv.slice(2);
  if (!baseUrl) throw new Error("usage: smoke <baseUrl> [maxPages] [--psi]");
  const maxPages = Number(maxPagesArg ?? 30) || 30;
  const t0 = Date.now();

  const crawl = await crawlSite({ baseUrl, seedPaths: [], maxPages });
  console.log(`crawled ${crawl.pages.length} pages in ${((Date.now() - t0) / 1000).toFixed(1)}s (truncated=${crawl.truncated}); sitemap=${crawl.sitemap.status} (${crawl.sitemap.urls.length} urls) robots=${crawl.robotsTxt.status} llms=${crawl.llmsTxt.status}`);
  for (const [url, classes] of Object.entries(crawl.stylesheetClasses)) console.log(`stylesheet ${url}: ${classes.length} classes`);

  const knownPages = new Map(crawl.pages.map((p) => [p.url, p.status]));
  const links = await checkLinks(crawl, { maxUrls: 150, knownPages });
  console.log(`checked ${links.length} links in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const psi: PsiResult[] = flags.includes("--psi") ? [await runPsi(baseUrl, "/", "mobile", process.env.PSI_API_KEY)] : [];
  if (psi[0]) console.log("psi:", psi[0].performanceScore, psi[0].error ?? "");

  const input: AnalysisInput = {
    siteBaseUrl: baseUrl,
    hasCustomDomain: !/webflow\.io/.test(baseUrl),
    webflow: { site: { id: "x", workspaceId: "w", displayName: "smoke", shortName: "smoke" }, pages: [], registeredScripts: [], siteCustomCode: null, pageCustomCode: [], fetchedAt: new Date().toISOString() },
    crawl,
    links,
    psi,
    previousPsi: [],
  };
  const findings = [...seoChecks(input), ...aeoChecks(input), ...performanceChecks(input), ...linkChecks(input), ...unusedChecks(input), ...namingChecks(input)];
  const { scores, overall } = scoreCategories(findings);
  console.log("scores:", scores, "overall:", overall);
  const counts: Record<string, number> = {};
  for (const f of findings) counts[`${f.severity} ${f.checkId}`] = (counts[`${f.severity} ${f.checkId}`] ?? 0) + 1;
  for (const [k, v] of Object.entries(counts).sort()) console.log(`${String(v).padStart(4)}  ${k}`);
  for (const f of findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 15)) console.log(` - [${f.severity}] ${f.title} ${f.pagePath ?? ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
