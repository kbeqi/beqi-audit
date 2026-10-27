import type { CategoryKey, Finding, Severity } from "@/db/schema";
import { CATEGORY_LABELS, CATEGORY_ORDER, SEVERITY_ORDER } from "@/audit/score";
import { ignoreFinding, markFindingState } from "@/app/actions";
import { SeverityPill, buttonSecondaryCls } from "./ui";

const sevRank = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, i])) as Record<Severity, number>;

export function FindingsList({ findings, siteId, baseUrl, back, showIgnored = false }: { findings: Finding[]; siteId: string; baseUrl: string; back: string; showIgnored?: boolean }) {
  const visible = showIgnored ? findings : findings.filter((f) => !f.ignored);
  if (visible.length === 0) return <p className="text-sm text-zinc-500">No findings.</p>;
  const groups = new Map<CategoryKey, Finding[]>();
  for (const f of visible) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category)!.push(f);
  }
  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.filter((c) => groups.has(c)).map((cat) => {
        const list = groups.get(cat)!.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (a.pagePath ?? "").localeCompare(b.pagePath ?? ""));
        return (
          <section key={cat}>
            <h3 className="mb-2 text-sm font-semibold">
              {CATEGORY_LABELS[cat]} <span className="font-normal text-zinc-500">({list.length})</span>
            </h3>
            <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
              {list.map((f) => (
                <FindingRow key={f.id} f={f} siteId={siteId} baseUrl={baseUrl} back={back} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function FindingRow({ f, siteId, baseUrl, back }: { f: Finding; siteId: string; baseUrl: string; back: string }) {
  const data = (f.data ?? {}) as Record<string, unknown>;
  const list = pickList(data);
  return (
    <li className={`px-3 py-2 text-sm ${f.ignored ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <SeverityPill severity={f.severity} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{f.title}</div>
          {f.pagePath && (
            <a href={new URL(f.pagePath, baseUrl).toString()} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline">
              {f.pagePath}
            </a>
          )}
          {f.detail && <p className="mt-1 text-xs text-zinc-600 break-words">{f.detail}</p>}
          {list && (
            <details className="mt-1 text-xs text-zinc-600">
              <summary className="cursor-pointer select-none">{list.label} ({list.items.length})</summary>
              <ul className="mt-1 max-h-48 overflow-auto font-mono">
                {list.items.map((x, i) => (
                  <li key={i} className="truncate">{x}</li>
                ))}
              </ul>
            </details>
          )}
          {f.ignored && <span className="text-xs text-zinc-500">ignored by rule</span>}
        </div>
        {!f.ignored && (
          <div className="flex shrink-0 gap-1">
            <form action={ignoreFinding}>
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="checkId" value={f.checkId} />
              <input type="hidden" name="pagePath" value={f.pagePath ?? ""} />
              <input type="hidden" name="scope" value={f.pagePath ? "page" : "site"} />
              <input type="hidden" name="back" value={back} />
              <button className={`${buttonSecondaryCls} !px-2 !py-1 !text-xs`} title="Suppress this check on this page in future runs">
                Ignore
              </button>
            </form>
            <form action={markFindingState}>
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="fingerprint" value={f.fingerprint} />
              <input type="hidden" name="status" value="false_positive" />
              <input type="hidden" name="back" value={back} />
              <button className={`${buttonSecondaryCls} !px-2 !py-1 !text-xs`} title="Hide this finding; it stays hidden unless reopened">
                Not an issue
              </button>
            </form>
          </div>
        )}
      </div>
    </li>
  );
}

function pickList(data: Record<string, unknown>): { label: string; items: string[] } | null {
  for (const [key, label] of [
    ["unused", "Unused classes"],
    ["classes", "Classes"],
    ["pages", "Pages"],
    ["referrers", "Linked from"],
    ["images", "Images"],
    ["scripts", "Scripts"],
    ["hosts", "Hosts"],
    ["blocked", "Blocked crawlers"],
    ["h1s", "H1 headings"],
  ] as const) {
    const v = data[key];
    if (Array.isArray(v) && v.length > 0) return { label, items: v.map(String) };
  }
  return null;
}
