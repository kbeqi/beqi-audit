import Link from "next/link";
import { requireSignedIn } from "@/app/gate";
import { currentActorOrNull } from "@/lib/auth";
import { notFound } from "next/navigation";
import { proposalDetail } from "@/lib/queries";
import { LiveLog } from "@/components/live-log";
import type { Metadata } from "next";
import type { FixAction } from "@/agent/catalog";
import { ACTION_NOTES, ChangeDiff, DecisionButtons, actionLabel } from "@/components/proposals";
import { Card, CardHeader, Crumbs, KeyValue, Notice, PageHeader, ProposalStatusPill, RiskPill, SeverityPill, fmtDate, hostOf } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await currentActorOrNull())) return { title: "Sign in" };
  const data = await proposalDetail(id);
  return { title: data ? `${data.proposal.title ?? actionLabel(data.proposal.action)} · ${data.site.name}` : "Fix" };
}

export default async function FixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSignedIn(`/fixes/${id}`);
  const data = await proposalDetail(id);
  if (!data) notFound();
  const { proposal, site, client, finding, events } = data;
  const clientName = client?.name ?? "Client";
  const live = proposal.status === "applying";
  const changes = proposal.proposal?.changes ?? [];
  const target = proposal.target;

  return (
    <div className="space-y-6">
      <Crumbs items={[{ href: "/clients", label: "Clients" }, { href: `/clients/${site.clientId}`, label: clientName }, { href: `/clients/${site.clientId}/fixes`, label: "Fixes" }, { label: proposal.title ?? actionLabel(proposal.action) }]} />
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <ProposalStatusPill status={proposal.status} />
            <RiskPill risk={proposal.risk} />
            <span>{actionLabel(proposal.action)}</span>
          </span>
        }
        title={proposal.title ?? actionLabel(proposal.action)}
        description={
          target?.pagePath ? (
            <a href={safeJoin(site.baseUrl, target.pagePath)} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
              {hostOf(site.baseUrl)}
              {target.pagePath}
            </a>
          ) : (
            hostOf(site.baseUrl)
          )
        }
        actions={<DecisionButtons proposal={proposal} back={`/clients/${site.clientId}/fixes`} />}
      />

      {proposal.status === "applied" && proposal.result && (
        <Notice tone="good">
          Applied. {proposal.result.summary}
          {proposal.result.needsPublish && (
            <>
              {" "}
              <strong>Publish the site in Webflow for this change to go live.</strong>
            </>
          )}
        </Notice>
      )}
      {proposal.status === "resolved" && (
        <Notice tone="good">
          Fixed manually by {proposal.appliedBy ?? "a team member"} on {fmtDate(proposal.appliedAt)}. Nothing was written by Claude; the next audit confirms the issue is gone, and reopens it if not.
        </Notice>
      )}
      {proposal.status === "failed" && (
        <Notice tone="critical">
          <strong>Not applied.</strong> {proposal.error ?? "Unknown error."}
          {proposal.action === "image_compress" ? " Retrying the same conversion will fail again; resize or re-export the image in Webflow instead." : " You can retry, or reject it."}
        </Notice>
      )}
      {proposal.status === "approved" && proposal.result?.status === "skipped" && (
        <Notice tone="warn">Skipped: {proposal.result.summary} Review the current value, then approve again if it still applies.</Notice>
      )}
      {live && <Notice tone="accent">Claude is applying this change and will read it back to verify.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Proposed change" description="What Claude will write (− current, + new)" />
            <div className="p-5">
              {changes.length ? <ChangeDiff changes={changes} /> : <p className="text-sm text-ink-3">No field-level changes recorded.</p>}
              {proposal.rationale && (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Why</div>
                  <p className="text-sm text-ink-2">{proposal.rationale}</p>
                </div>
              )}
              {ACTION_NOTES[proposal.action as FixAction] && (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">What applying does</div>
                  <p className="text-sm text-ink-2">{ACTION_NOTES[proposal.action as FixAction]}</p>
                </div>
              )}
            </div>
          </Card>

          {(events.length > 0 || live) && (
            <Card>
              <CardHeader title="Agent activity" description={live ? "Live" : `${events.length} events`} />
              <LiveLog streamId={proposal.id} initial={events} live={live} />
            </Card>
          )}

          {proposal.result && proposal.result.changesMade.length > 0 && (
            <Card>
              <CardHeader title="What was written" description={proposal.result.verification} />
              <div className="p-5">
                <ChangeDiff changes={proposal.result.changesMade} />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {finding && (
            <Card>
              <CardHeader title="Finding" />
              <div className="space-y-2 p-5 text-sm">
                <div className="flex items-center gap-2">
                  <SeverityPill severity={finding.severity} />
                  <span className="font-mono text-xs text-ink-3">{finding.checkId}</span>
                </div>
                <div className="font-medium text-ink">{finding.title}</div>
                {finding.detail && <p className="text-ink-2">{finding.detail}</p>}
                <Link href={`/runs/${finding.runId}`} className="inline-block text-xs text-accent hover:underline">
                  From this audit →
                </Link>
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Details" />
            <div className="p-5">
              <KeyValue
                items={[
                  { k: "Proposed", v: fmtDate(proposal.createdAt) },
                  { k: "Approved by", v: proposal.approvedBy ?? "—" },
                  { k: "Applied", v: proposal.appliedAt ? `${fmtDate(proposal.appliedAt)} by ${proposal.appliedBy ?? "—"}` : "—" },
                  { k: "Page id", v: <span className="font-mono text-xs">{target?.pageId ?? "—"}</span> },
                  ...(target?.assetId ? [{ k: "Asset id", v: <span className="font-mono text-xs">{target.assetId}</span> }] : []),
                  ...(target?.elementId ? [{ k: "Element id", v: <span className="font-mono text-xs">{target.elementId}</span> }] : []),
                  ...(target?.scriptId ? [{ k: "Script id", v: <span className="font-mono text-xs">{target.scriptId}</span> }] : []),
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function safeJoin(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return base;
  }
}
