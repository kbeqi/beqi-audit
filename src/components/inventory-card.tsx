import type { RunSummary } from "@/db/schema";
import { Card, CardHeader } from "./ui";

type InventorySummary = NonNullable<RunSummary["inventory"]>;

// The URL inventory check, shown inside the SEO area: how many URLs serve,
// redirect or are broken, whether robots.txt and the sitemap are in order,
// and what changed since the previous audit.
export function InventoryCard({ summary, embedded = false, audience = "team" }: { summary: InventorySummary; embedded?: boolean; audience?: "team" | "client" }) {
  const Wrap = embedded ? "div" : Card;
  const c = summary.changes;
  const changed = c ? c.gone + c.redirected + c.noindexed : 0;
  const tiles: { label: string; value: string; tone?: "good" | "warn" | "critical"; hint?: string }[] = [
    { label: "URLs checked", value: String(summary.pages), hint: `${summary.sitemapUrls} in the sitemap` },
    { label: "Serving fine", value: String(summary.ok), tone: summary.ok === summary.pages ? "good" : undefined },
    { label: "Redirecting", value: String(summary.redirects), tone: summary.redirects ? "warn" : undefined },
    { label: "Broken", value: String(summary.broken), tone: summary.broken ? "critical" : "good" },
    { label: "Noindex", value: String(summary.noindex), tone: summary.noindex ? "warn" : undefined },
    { label: "robots.txt · sitemap", value: `${summary.robotsOk ? "ok" : "problem"} · ${summary.sitemapOk ? "ok" : "problem"}`, tone: summary.robotsOk && summary.sitemapOk ? "good" : "critical" },
  ];
  const toneCls = (t?: string) => (t === "good" ? "text-good-text" : t === "warn" ? "text-warn-text" : t === "critical" ? "text-critical-text" : "text-ink");
  return (
    <Wrap className={embedded ? "" : undefined}>
      {!embedded && <CardHeader title="Pages and indexability" description="Every published page and sitemap URL fetched once, compared with the previous audit" />}
      <div className={embedded ? "border-b border-line px-5 py-4" : "p-5"}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-ink">Pages and indexability</div>
          <div className="text-xs text-ink-3">{audience === "client" ? "Every page of the site is checked on each audit; anything that breaks or disappears shows up here." : "Deterministic: from the Webflow page list, sitemap.xml and one fetch per URL."}</div>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg bg-surface-2 px-3 py-2">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{t.label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold leading-none num ${toneCls(t.tone)}`}>{t.value}</dd>
              {t.hint && <dd className="mt-1 text-xs text-ink-3">{t.hint}</dd>}
            </div>
          ))}
        </dl>
        <p className={`mt-2 text-xs ${changed ? "font-medium text-warn-text" : "text-ink-3"}`}>
          {c
            ? changed
              ? `Since the last audit: ${c.gone} page${c.gone === 1 ? "" : "s"} gone, ${c.redirected} now redirect${c.redirected === 1 ? "s" : ""}, ${c.noindexed} became noindex${c.sitemapDelta ? `, sitemap ${c.sitemapDelta > 0 ? "+" : ""}${c.sitemapDelta} URLs` : ""}. Details in the findings below.`
              : `No page lost, redirected or de-indexed since the last audit${c.sitemapDelta ? ` (sitemap ${c.sitemapDelta > 0 ? "+" : ""}${c.sitemapDelta} URLs)` : ""}.`
            : "First audit with the guard: the next one compares against this inventory."}
        </p>
      </div>
    </Wrap>
  );
}
