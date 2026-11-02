import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientAccess } from "@/app/gate";
import { isTeam } from "@/lib/auth";
import { clientHeader } from "@/lib/queries";
import { runClientNow } from "@/app/actions";
import { ClientTabs } from "@/components/client-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Crumbs, Notice, StatusPill, btnPrimary, btnSecondary } from "@/components/ui";

export const dynamic = "force-dynamic";

// Shared frame for every client tab: breadcrumb, logo or name, Audit now, tabs.
// A client user sees the same hub without the team-only controls.
export default async function ClientLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const actor = await requireClientAccess(id, `/clients/${id}`);
  const team = isTeam(actor);
  const h = await clientHeader(id);
  if (!h) notFound();
  const { client, siteCount, connectedCount, running, pendingFixes, hasCompleted, lostConnections } = h;
  void siteCount;
  const logoUrl = client.logoKey ? `/api/clients/${client.id}/logo?v=${encodeURIComponent(client.logoUpdatedAt ?? "")}` : null;
  const allRunning = connectedCount > 0 && running.length >= connectedCount;

  return (
    <div className="space-y-5">
      {team ? <Crumbs items={[{ href: "/", label: "Clients" }, { label: client.name }]} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          {logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- served from KV, not a static asset */}
              <img src={logoUrl} alt={client.name} className="max-h-12 w-auto max-w-[240px] object-contain" />
              <span className="sr-only">{client.name}</span>
            </>
          ) : (
            <div className="text-2xl font-semibold tracking-tight text-ink">{client.name}</div>
          )}
          <div className="mt-1 text-sm text-ink-3">
            {h.siteHost ? (
              <a href={`https://${h.siteHost}`} target="_blank" rel="noreferrer" className="text-accent underline decoration-line-2 underline-offset-2 hover:decoration-accent">
                {h.siteHost}
              </a>
            ) : (
              "No site yet"
            )}
            {team ? (connectedCount ? " · connected to Webflow" : " · Webflow not connected") : client.leadName ? ` · your Beqi lead: ${client.leadName}` : " · looked after by Beqi"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running.length > 0 && (
            <Link href={`/runs/${running[0].id}`} className={btnSecondary}>
              <StatusPill status="running" /> View progress
            </Link>
          )}
          {team && (
            <form action={runClientNow}>
              <input type="hidden" name="clientId" value={client.id} />
              <SubmitButton
                className={btnPrimary}
                disabled={connectedCount === 0 || allRunning}
                pendingLabel="Starting…"
                title={connectedCount === 0 ? "Connect the client's Webflow workspace first (Settings)" : undefined}
              >
                {allRunning ? "Audit running" : hasCompleted ? "Audit now" : connectedCount ? "Run first audit" : "Audit now"}
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
      {team && <ClientTabs clientId={client.id} counts={{ audits: 0, pendingFixes, sites: siteCount, running: running.length > 0 }} showSettings />}
      {lostConnections > 0 &&
        (team ? (
          <Notice tone="serious">
            <strong>Webflow connection lost.</strong> Audits and fixes for this client cannot run until the workspace is connected again:{" "}
            <Link href={`/clients/${client.id}/settings`} className="font-medium underline">
              open Settings and click Connect Webflow
            </Link>
            . Existing audits, findings and fixes are kept.
          </Notice>
        ) : (
          <Notice tone="warn">
            <strong>Audits are paused</strong> while Beqi reconnects this site&apos;s Webflow workspace. Your existing reports and fixes are all still here.
          </Notice>
        ))}
      <div>{children}</div>
    </div>
  );
}
