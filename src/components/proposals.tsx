import Link from "next/link";
import type { FixProposal, Site } from "@/db/schema";
import type { FixAction } from "@/agent/catalog";
import { decideProposal } from "@/app/actions";
import { ProposalStatusPill, RiskPill, btnDanger, btnPrimary, btnSecondary, btnSm, timeAgo } from "./ui";

export const ACTION_LABELS: Record<FixAction, string> = {
  page_seo: "Page SEO settings",
  schema_markup: "Schema markup (JSON-LD)",
  sitemap_flag: "Sitemap inclusion",
  alt_text: "Image alt text",
  heading_level: "Heading level",
  custom_code: "Custom code",
  remove_script: "Remove script",
  image_compress: "Compress images",
  manual: "Manual",
};

export function actionLabel(action: string): string {
  return (ACTION_LABELS as Record<string, string>)[action] ?? action;
}

// JSON values (schema markup) are shown pretty-printed; everything else as text.
function prettyJson(v: string): string | null {
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

function Value({ v, removed = false }: { v: string; removed?: boolean }) {
  const cls = removed ? "text-ink-3 line-through decoration-line-2" : "text-ink";
  const pretty = prettyJson(v);
  if (pretty) return <pre className={`whitespace-pre-wrap break-all font-mono text-xs leading-relaxed ${cls}`}>{pretty}</pre>;
  return <span className={`break-words ${cls}`}>{v}</span>;
}

export function ChangeDiff({ changes }: { changes: { field: string; from: string | null; to: string }[] }) {
  if (!changes.length) return null;
  return (
    <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line text-sm">
      {changes.map((c, i) => (
        <div key={i} className="grid gap-1 px-3 py-2 md:grid-cols-[9rem_1fr]">
          <dt className="break-words font-mono text-xs text-ink-3">{c.field}</dt>
          <dd className="min-w-0 space-y-1">
            {c.from != null && c.from !== "" && (
              <div className="flex gap-2">
                <span aria-hidden className="shrink-0 text-critical">−</span>
                <Value v={c.from} removed />
              </div>
            )}
            <div className="flex gap-2">
              <span aria-hidden className="shrink-0 text-up">+</span>
              <Value v={c.to} />
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DecisionButtons({ proposal, back, size = "md" }: { proposal: FixProposal; back: string; size?: "sm" | "md" }) {
  const sm = size === "sm" ? btnSm : "";
  const reviewable = proposal.status === "proposed" || proposal.status === "approved" || proposal.status === "failed";
  if (!reviewable) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <form action={decideProposal}>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <input type="hidden" name="decision" value="apply" />
        <input type="hidden" name="back" value={back} />
        <button className={`${btnPrimary} ${sm}`}>{proposal.status === "failed" ? "Retry" : "Approve & apply"}</button>
      </form>
      {proposal.status === "proposed" && (
        <form action={decideProposal}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="decision" value="approve" />
          <input type="hidden" name="back" value={back} />
          <button className={`${btnSecondary} ${sm}`}>Approve only</button>
        </form>
      )}
      <form action={decideProposal}>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <input type="hidden" name="decision" value="reject" />
        <input type="hidden" name="back" value={back} />
        <button className={`${btnDanger} ${sm}`}>Reject</button>
      </form>
    </div>
  );
}

// A proposal in a list: enough to decide without opening it. `compact` (narrow
// columns) drops the diff and stacks the buttons under the text.
export function ProposalRow({ proposal, site, back, compact = false }: { proposal: FixProposal; site?: Site; back: string; compact?: boolean }) {
  const changes = proposal.proposal?.changes ?? [];
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_18rem]">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/fixes/${proposal.id}`} className="text-sm font-medium text-ink hover:underline">
              {proposal.title ?? actionLabel(proposal.action)}
            </Link>
            <ProposalStatusPill status={proposal.status} />
            <RiskPill risk={proposal.risk} />
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-3">
            {site && (
              <Link href={`/sites/${site.id}`} className="hover:underline">
                {site.name}
              </Link>
            )}
            {proposal.target?.pagePath && <span className="font-mono">{proposal.target.pagePath}</span>}
            <span>{actionLabel(proposal.action)}</span>
            <span>{timeAgo(proposal.createdAt)}</span>
          </div>
          {proposal.rationale && <p className={`mt-1.5 text-sm text-ink-2 ${compact ? "line-clamp-2" : ""}`}>{proposal.rationale}</p>}
          {changes.length > 0 && !compact && (
            <div className="mt-2">
              <ChangeDiff changes={changes.slice(0, 3)} />
              {changes.length > 3 && (
                <Link href={`/fixes/${proposal.id}`} className="mt-1 inline-block text-xs text-accent hover:underline">
                  +{changes.length - 3} more changes
                </Link>
              )}
            </div>
          )}
          {compact && changes.length > 0 && (
            <Link href={`/fixes/${proposal.id}`} className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline">
              View {changes.length === 1 ? "the change" : `${changes.length} changes`} →
            </Link>
          )}
          {proposal.error && <p className="mt-1.5 text-xs text-critical">{proposal.error}</p>}
        </div>
        <div className={`shrink-0 ${compact ? "basis-full" : ""}`}>
          <DecisionButtons proposal={proposal} back={back} size="sm" />
        </div>
      </div>
    </li>
  );
}
