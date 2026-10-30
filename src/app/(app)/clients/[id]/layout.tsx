import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSignedIn } from "@/app/gate";
import { clientHeader } from "@/lib/queries";
import { runClientNow } from "@/app/actions";
import { ClientTabs } from "@/components/client-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Crumbs, Notice, StatusPill, btnPrimary, btnSecondary } from "@/components/ui";

export const dynamic = "force-dynamic";

// Shared frame for every client tab: breadcrumb, logo or name, Audit now, tabs.
export default async function ClientLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  await requireSignedIn(`/clients/${id}`);
  const h = await clientHeader(id);
  if (!h) notFound();
  const { client, siteCount, connectedCount, running, pendingFixes, hasCompleted, lostConnections } = h;
  const logoUrl = client.logoKey ? `/api/clients/${client.id}/logo?v=${encodeURIComponent(client.logoUpdatedAt ?? "")}` : null;
  const allRunning = connectedCount > 0 && running.length >= connectedCount;

  return (
    <div className="space-y-5">
      <Crumbs items={[{ href: "/clients", label: "Clients" }, { label: client.name }]} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          {logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- served from KV, not a static asset */}
              <img src={logoUrl} alt={client.name} className="max-h-12 w-auto max-w-[240px] object-contain" />
              <h1 className="sr-only">{client.name}</h1>
            </>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{client.name}</h1>
          )}
          <div className="mt-1 text-sm text-ink-3">
            {siteCount} site{siteCount === 1 ? "" : "s"}
            {connectedCount ? ` · ${connectedCount} connected to Webflow` : " · Webflow not connected"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running.length > 0 && (
            <Link href={`/runs/${running[0].id}`} className={btnSecondary}>
              <StatusPill status="running" /> {running.length === 1 ? "View progress" : `${running.length} running`}
            </Link>
          )}
          <form action={runClientNow}>
            <input type="hidden" name="clientId" value={client.id} />
            <SubmitButton
              className={btnPrimary}
              disabled={connectedCount === 0 || allRunning}
              pendingLabel="Starting…"
              title={connectedCount === 0 ? "Connect the client's Webflow workspace first (Settings)" : connectedCount > 1 ? `Audits every connected site (${connectedCount})` : undefined}
            >
              {allRunning ? "Audit running" : hasCompleted ? "Audit now" : connectedCount ? "Run first audit" : "Audit now"}
            </SubmitButton>
          </form>
        </div>
      </div>
      <ClientTabs clientId={client.id} counts={{ audits: 0, pendingFixes, sites: siteCount, running: running.length > 0 }} />
      {lostConnections > 0 && (
        <Notice tone="serious">
          <strong>Webflow connection lost.</strong> Audits and fixes for this client cannot run until the workspace is connected again:{" "}
          <Link href={`/clients/${client.id}/settings`} className="font-medium underline">
            open Settings and click Connect Webflow
          </Link>
          . Existing audits, findings and fixes are kept.
        </Notice>
      )}
      <div>{children}</div>
    </div>
  );
}
