import type { AnalysisInput, FindingDraft } from "../types";

export function linkChecks(input: AnalysisInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const { links, crawl, hasCustomDomain } = input;

  for (const l of links) {
    const refs = { data: { referrers: l.referrers.slice(0, 25), status: l.status, finalUrl: l.finalUrl } };
    const firstPage = l.referrers[0];
    if (l.status === null) {
      out.push({ category: "links", checkId: l.internal ? "links.internal-unreachable" : "links.external-unreachable", severity: l.internal ? "high" : "low", title: `${l.internal ? "Internal" : "External"} link could not be reached`, detail: `${l.url} — ${l.error ?? "network error"}; linked from ${l.referrers.length} page(s)`, subject: l.url, pagePath: firstPage, ...refs });
    } else if (l.status >= 400) {
      out.push({ category: "links", checkId: l.internal ? "links.internal-broken" : "links.external-broken", severity: l.internal ? "high" : "medium", title: `${l.internal ? "Internal" : "External"} link returns ${l.status}`, detail: `${l.url} — linked from ${l.referrers.length} page(s)`, subject: l.url, pagePath: firstPage, ...refs });
    } else if (l.hops > 1) {
      out.push({ category: "links", checkId: "links.redirect-chain", severity: "low", title: `Link redirects ${l.hops} times before resolving`, detail: `${l.url} → ${l.finalUrl}`, subject: l.url, pagePath: firstPage, ...refs });
    } else if (l.hops === 1 && l.internal) {
      out.push({ category: "links", checkId: "links.internal-redirect", severity: "info", title: "Internal link points at a redirecting URL", detail: `${l.url} → ${l.finalUrl}. Link to the final URL directly.`, subject: l.url, pagePath: firstPage, ...refs });
    }

    if (l.url.startsWith("http://") && crawl.baseUrl.startsWith("https://")) {
      out.push({ category: "links", checkId: "links.insecure-http", severity: "low", title: "Link uses http:// on an https site", detail: l.url, subject: l.url, pagePath: firstPage, ...refs });
    }
    if (hasCustomDomain && /\.webflow\.io(\/|$)/i.test(l.url)) {
      out.push({ category: "links", checkId: "links.staging-domain", severity: "medium", title: "Link points at the webflow.io staging domain", detail: l.url, subject: l.url, pagePath: firstPage, ...refs });
    }
  }

  // Pages themselves that failed to load during the crawl.
  for (const p of crawl.pages) {
    if (p.status === 0 || p.error) {
      out.push({ category: "links", checkId: "links.page-fetch-failed", severity: "high", title: "Page could not be fetched during the crawl", detail: p.error ?? "no response", pagePath: p.path });
    } else if (p.status >= 400) {
      out.push({ category: "links", checkId: "links.page-error-status", severity: "high", title: `Page returns ${p.status}`, pagePath: p.path });
    }
  }
  if (crawl.truncated) {
    out.push({ category: "links", checkId: "links.crawl-truncated", severity: "info", title: "Crawl stopped at the page limit; some pages were not checked", detail: `Raise the site's max pages setting to cover the whole site.` });
  }

  return out;
}
