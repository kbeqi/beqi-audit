import type { AnalysisInput, FindingDraft } from "../types";

// Unused CSS classes, unused registered scripts, duplicate tracking tags and
// render-blocking scripts. All of it comes from the published site plus the
// Data API, so no Designer session is needed.

// Each pattern matches the *loader* of a tag once per copy (a script src, or
// the init call of an inline snippet). Config calls that reference the same id
// again are deliberately not matched, so one loader + one config is not a duplicate.
const TRACKERS: { id: string; label: string; re: RegExp }[] = [
  { id: "gtm", label: "Google Tag Manager", re: /googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/g },
  { id: "ga4", label: "Google Analytics", re: /gtag\/js\?id=(G-[A-Z0-9]+)/g },
  { id: "meta", label: "Meta Pixel", re: /fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,})['"]/g },
  { id: "hotjar", label: "Hotjar", re: /hjid\s*:\s*(\d+)/g },
  { id: "hubspot", label: "HubSpot", re: /js\.hs-scripts\.com\/(\d+)\.js/g },
  { id: "clarity", label: "Microsoft Clarity", re: /clarity\.ms\/tag\/([a-z0-9]+)/g },
];

export function unusedChecks(input: AnalysisInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const { crawl, webflow } = input;
  const pages = crawl.pages.filter((p) => p.status === 200 && p.contentType?.includes("text/html"));

  // 1. Unused classes: defined in the site stylesheet, used on no crawled page.
  const defined = new Set<string>();
  for (const classes of Object.values(crawl.stylesheetClasses)) for (const c of classes) defined.add(c);
  const used = new Set<string>();
  for (const p of pages) for (const c of p.classes) used.add(c);
  if (defined.size > 0) {
    const unused = [...defined].filter((c) => !used.has(c) && !isStateOrPseudoClass(c)).sort();
    const ratio = unused.length / defined.size;
    if (unused.length > 0) {
      out.push({
        category: "unused",
        checkId: "unused.css-classes",
        severity: ratio > 0.4 ? "medium" : ratio > 0.15 ? "low" : "info",
        title: `${unused.length} of ${defined.size} CSS classes are not used on any crawled page`,
        detail: crawl.truncated
          ? "The crawl was truncated, so some of these may be used on pages that were not fetched. Classes used only in interactions or custom code are also reported here."
          : "Classes used only by interactions, embeds or custom code can show up here; review before cleaning. Webflow's Designer Audit panel removes unused styles.",
        data: { unused: unused.slice(0, 300), definedCount: defined.size, usedCount: used.size },
      });
    }
  }

  // 2. Registered scripts applied nowhere.
  const applied = new Set<string>();
  for (const s of webflow.siteCustomCode?.scripts ?? []) applied.add(s.id);
  for (const block of webflow.pageCustomCode) for (const s of block.scripts) applied.add(s.id);
  for (const rs of webflow.registeredScripts) {
    if (!applied.has(rs.id)) {
      out.push({ category: "unused", checkId: "unused.registered-script", severity: "low", title: `Registered script "${rs.displayName}" (v${rs.version}) is not applied to the site or any page`, subject: rs.id, data: { scriptId: rs.id, hostedLocation: rs.hostedLocation } });
    }
  }

  // 3. Duplicate tracking tags and render-blocking scripts, per page.
  for (const p of pages) {
    const ref = { pagePath: p.path };
    const blob = p.scripts.map((s) => (s.src ?? "") + " " + (s.snippet ?? "")).join("\n");
    for (const t of TRACKERS) {
      const ids = new Map<string, number>();
      for (const m of blob.matchAll(t.re)) {
        const id = m[1] ?? m[0];
        ids.set(id, (ids.get(id) ?? 0) + 1);
      }
      for (const [id, count] of ids) {
        if (count > 1) out.push({ category: "unused", checkId: "unused.duplicate-tracker", severity: "medium", title: `${t.label} tag ${id} is loaded ${count} times on this page`, detail: "Double-counted analytics and extra script weight. Usually one copy lives in site custom code and another in the page or an embed.", subject: `${t.id}:${id}`, ...ref });
      }
    }

    const blocking = p.scripts.filter((s) => s.src && s.inHead && !s.async && !s.defer && s.type !== "module");
    if (blocking.length > 0) {
      out.push({ category: "unused", checkId: "unused.render-blocking-scripts", severity: blocking.length > 2 ? "medium" : "low", title: `${blocking.length} external script${blocking.length > 1 ? "s" : ""} in <head> without async/defer`, data: { scripts: blocking.map((s) => s.src) }, ...ref });
    }

    const thirdParty = new Set<string>();
    for (const s of p.scripts) {
      if (!s.src) continue;
      try {
        const h = new URL(s.src).host;
        if (h !== crawl.host && !/website-files\.com|webflow\.com/i.test(h)) thirdParty.add(h);
      } catch {
        /* ignore */
      }
    }
    if (thirdParty.size > 6) {
      out.push({ category: "unused", checkId: "unused.many-third-party-scripts", severity: "low", title: `${thirdParty.size} third-party script hosts on this page`, data: { hosts: [...thirdParty] }, ...ref });
    }
  }

  return out;
}

// Webflow state classes and pseudo-ish names that legitimately appear only at runtime.
function isStateOrPseudoClass(c: string): boolean {
  return /^(w-|w--|wf-|is-|active|current|open|show|hidden)/.test(c) || /--(current|open|active|hover|disabled)$/.test(c);
}
