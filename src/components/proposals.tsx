import Link from "next/link";
import type { FixProposal, Site } from "@/db/schema";
import type { FixAction } from "@/agent/catalog";
import { decideProposal } from "@/app/actions";
import { SubmitButton } from "./submit-button";
import { ProposalStatusPill, RiskPill, btnPrimary, btnSecondary, btnSm, timeAgo } from "./ui";

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

// What applying each kind of fix means for the site, shown before approval.
export const ACTION_NOTES: Partial<Record<FixAction, string>> = {
  page_seo: "Changes page settings in Webflow; goes live on the next publish.",
  schema_markup: "Writes JSON-LD to the page settings; goes live on the next publish.",
  sitemap_flag: "Changes the page's sitemap setting; goes live on the next publish.",
  alt_text: "Updates the asset's alt text; takes effect immediately wherever the asset is used.",
  heading_level: "Changes the element's heading tag; styling is unchanged. Goes live on the next publish.",
  custom_code: "Edits head/footer code; goes live on the next publish.",
  remove_script: "Removes an applied script; goes live on the next publish.",
  image_compress: "Replaces the asset file in place and cannot be undone from here. Keep an original copy. Webflow refuses the conversion if it would not be smaller.",
};

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
                <span aria-hidden className="shrink-0 text-critical-text">−</span>
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

// Two decisions: apply (Claude writes it now) or reject. "Approve for later"
// was a dead end, since nothing applies approved rows on its own.
export function DecisionButtons({ proposal, back, size = "md" }: { proposal: FixProposal; back: string; size?: "sm" | "md" }) {
  const sm = size === "sm" ? btnSm : "";
  const reviewable = proposal.status === "proposed" || proposal.status === "approved" || proposal.status === "failed";
  if (!reviewable) return null;
  const risky = proposal.risk === "high" || proposal.action === "image_compress";
  const applyLabel = proposal.status === "failed" ? "Retry" : "Approve & apply";
  return (
    <div className="flex flex-wrap gap-2">
      <form action={decideProposal}>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <input type="hidden" name="decision" value="apply" />
        <input type="hidden" name="back" value={back} />
        {risky ? (
          <SubmitButton confirm={`${ACTION_NOTES[proposal.action as FixAction] ?? "This change is marked as higher risk."}\n\nApply it now?`} className={`${btnPrimary} ${sm}`} pendingLabel="Handing to Claude…">
            {applyLabel}
          </SubmitButton>
        ) : (
          <SubmitButton className={`${btnPrimary} ${sm}`} pendingLabel="Handing to Claude…">{applyLabel}</SubmitButton>
        )}
      </form>
      <form action={decideProposal}>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <input type="hidden" name="decision" value="resolved" />
        <input type="hidden" name="back" value={back} />
        <SubmitButton
          className={`${btnSecondary} ${sm}`}
          confirm="Mark this as already fixed on the site by a person? Nothing is written to Webflow; the next audit re-checks it and reopens it if the issue is still there."
          pendingLabel="Saving…"
          title="A person already made this change in Webflow"
        >
          Fixed manually
        </SubmitButton>
      </form>
      <form action={decideProposal}>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <input type="hidden" name="decision" value="reject" />
        <input type="hidden" name="back" value={back} />
        <SubmitButton className={`${btnSecondary} ${sm}`} pendingLabel="Rejecting…" title="Don't make this change">
          Reject
        </SubmitButton>
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
          {proposal.error && <p className="mt-1.5 text-xs text-critical-text">{proposal.error}</p>}
        </div>
        <div className={`shrink-0 ${compact ? "basis-full" : ""}`}>
          <DecisionButtons proposal={proposal} back={back} size="sm" />
        </div>
      </div>
    </li>
  );
}
