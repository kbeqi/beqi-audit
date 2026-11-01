import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canSeeClient, requireTeam } from "@/app/gate";
import { clientDetail } from "@/lib/queries";
import { deleteClient, disconnectWorkspace, reimportSites, removeClientLogo, sendTestEmail, updateClient, uploadClientLogo } from "@/app/actions";
import { emailConfigured } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { ClientNotices, type ClientSearch } from "@/components/client-notices";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardHeader, EmptyState, btnDanger, btnPrimary, btnSecondary, btnSm, fmtDay, inputCls, labelCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await canSeeClient(id))) return { title: "Settings" };
  const data = await clientDetail(id);
  return { title: data ? `${data.client.name} · Settings` : "Settings" };
}

export default async function ClientSettings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch> }) {
  const { id } = await params;
  await requireTeam(`/clients/${id}/settings`);
  const q = await searchParams;
  const mailReady = emailConfigured(await getEnv());
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections } = data;
  const active = connections.filter((c) => !c.revokedAt);
  const logoUrl = client.logoKey ? `/api/clients/${client.id}/logo?v=${encodeURIComponent(client.logoUpdatedAt ?? "")}` : null;

  return (
    <div className="space-y-6">
      <ClientNotices q={q} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Client details" />
            <form action={updateClient} className="space-y-3 p-5">
              <input type="hidden" name="clientId" value={client.id} />
              <div>
                <label htmlFor="name" className={labelCls}>
                  Name
                </label>
                <input id="name" name="name" defaultValue={client.name} required className={inputCls} />
                {logoUrl && <p className="mt-1 text-xs text-ink-3">Used in lists and emails; the page header shows the logo instead.</p>}
              </div>
              <div>
                <label htmlFor="notes" className={labelCls}>
                  Notes
                </label>
                <textarea id="notes" name="notes" rows={3} defaultValue={client.notes ?? ""} className={inputCls} />
              </div>
              <fieldset className="rounded-lg border border-line p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Beqi lead</legend>
                <p className="mb-2 text-xs text-ink-3">The person at Beqi this client talks to. Shown in their hub and in emails they get from the app.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="leadName" className={labelCls}>
                      Name
                    </label>
                    <input id="leadName" name="leadName" defaultValue={client.leadName ?? ""} className={inputCls} placeholder="Kreshnik" />
                  </div>
                  <div>
                    <label htmlFor="leadEmail" className={labelCls}>
                      Email
                    </label>
                    <input id="leadEmail" name="leadEmail" type="email" defaultValue={client.leadEmail ?? ""} className={inputCls} placeholder="name@beqi.co" />
                  </div>
                </div>
              </fieldset>
              <fieldset className="rounded-lg border border-line p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Email notifications</legend>
                <div>
                  <label htmlFor="notifyEmail" className={labelCls}>
                    Send to
                  </label>
                  <input id="notifyEmail" name="notifyEmail" type="text" inputMode="email" defaultValue={client.notifyEmail ?? ""} placeholder="client@example.com, pm@beqi.co" className={inputCls} />
                  <p className="mt-1 text-xs text-ink-3">One or more addresses, separated by commas. Leave empty for no emails.</p>
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm text-ink-2">
                  <input name="notifyReminder" type="checkbox" defaultChecked={client.notifyReminder} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-ink">Reminder before each scheduled audit</span>
                    <span className="block text-xs text-ink-3">About a day ahead, saying when it runs and that nothing is changed on the site.</span>
                  </span>
                </label>
                <label className="mt-2 flex items-start gap-2 text-sm text-ink-2">
                  <input name="notifyResults" type="checkbox" defaultChecked={client.notifyResults} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-ink">Results when an audit finishes</span>
                    <span className="block text-xs text-ink-3">Score, finding counts, highlights and a link to the full report.</span>
                  </span>
                </label>
                {!mailReady && <p className="mt-3 rounded-md px-2 py-1.5 text-xs tone-warn">Email sending isn&apos;t configured yet (RESEND_API_KEY / EMAIL_FROM). Settings are saved and used once it is.</p>}
              </fieldset>
              <fieldset className="rounded-lg border border-line p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Slack</legend>
                <label htmlFor="slackWebhookUrl" className={labelCls}>
                  Incoming webhook URL
                </label>
                <input id="slackWebhookUrl" name="slackWebhookUrl" type="url" defaultValue={client.slackWebhookUrl ?? ""} className={inputCls} placeholder="https://hooks.slack.com/services/…" />
                <p className="mt-1 text-xs text-ink-3">Audit results and applied fixes are posted to this channel (the client&apos;s shared channel, or an internal one). Leave empty for none.</p>
              </fieldset>
              <SubmitButton className={btnPrimary} pendingLabel="Saving…">
                Save changes
              </SubmitButton>
            </form>
            {client.notifyEmail && (
              <form action={sendTestEmail} className="border-t border-line px-5 py-3">
                <input type="hidden" name="clientId" value={client.id} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-ink-2">
                    Emails go to <span className="font-medium text-ink">{client.notifyEmail}</span>
                  </span>
                  <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Sending…">
                    Send test email
                  </SubmitButton>
                </div>
              </form>
            )}
          </Card>

          <Card>
            <CardHeader title="Logo" description="Replaces the client's name at the top of their pages." />
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                {logoUrl && (
                  <div className="rounded-lg border border-line bg-surface-2 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served from KV */}
                    <img src={logoUrl} alt="" className="max-h-10 w-auto max-w-[200px] object-contain" />
                  </div>
                )}
                <form action={uploadClientLogo} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="clientId" value={client.id} />
                  <label htmlFor="logo" className="sr-only">
                    Logo file
                  </label>
                  <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" required className="text-sm text-ink-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-surface file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-ink" />
                  <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Uploading…">
                    {logoUrl ? "Replace logo" : "Upload logo"}
                  </SubmitButton>
                </form>
                {logoUrl && (
                  <form action={removeClientLogo}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Removing…">
                      Remove logo
                    </SubmitButton>
                  </form>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-3">PNG, JPG, SVG, WebP or GIF under 1 MB. A wide, transparent version works best.</p>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Webflow connections"
              description="Authorized through Webflow's MCP server, once per workspace"
              actions={
                // A plain anchor: Next's <Link> would prefetch this route and start an OAuth flow.
                <a href={`/api/webflow/authorize?client=${client.id}`} className={`${active.length ? btnSecondary : btnPrimary} ${btnSm}`}>
                  {active.length ? "Connect another workspace" : "Connect Webflow"}
                </a>
              }
            />
            {connections.length === 0 ? (
              <EmptyState title="Not connected" body="A Beqi team member with access to the client's workspace authorizes it once. No Webflow app install is needed." />
            ) : (
              <ul className="divide-y divide-line">
                {connections.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{c.label ?? c.workspaceName ?? "Workspace"}</div>
                      <div className="text-xs text-ink-3">
                        {c.authorizedSiteIds.length} site{c.authorizedSiteIds.length === 1 ? "" : "s"} · by {c.authorizedBy ?? "—"} · {fmtDay(c.createdAt)}
                        {c.revokedAt ? ` · disconnected ${fmtDay(c.revokedAt)}` : c.expiresAt ? ` · token renews automatically` : ""}
                      </div>
                    </div>
                    {!c.revokedAt && (
                      <div className="flex shrink-0 gap-1.5">
                        <form action={reimportSites}>
                          <input type="hidden" name="connectionId" value={c.id} />
                          <input type="hidden" name="clientId" value={client.id} />
                          <SubmitButton className={`${btnSecondary} ${btnSm}`} title="Read the workspace's site list again" pendingLabel="Importing…">
                            Re-import sites
                          </SubmitButton>
                        </form>
                        <form action={disconnectWorkspace}>
                          <input type="hidden" name="connectionId" value={c.id} />
                          <input type="hidden" name="clientId" value={client.id} />
                          <ConfirmButton message="Disconnect this workspace? Its sites stay in the app but cannot be audited until reconnected." className={`${btnDanger} ${btnSm}`} pendingLabel="Disconnecting…">
                            Disconnect
                          </ConfirmButton>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Client sign-in" description="People at the client who can open this hub" />
            <p className="p-5 text-sm text-ink-2">
              Add them on the Team page with the role <span className="font-medium text-ink">Client</span> and pick this client. They sign in with an email link, see this hub only, and can approve fixes: low-risk ones are applied straight away, the rest wait for Beqi.
            </p>
          </Card>

          <Card>
            <CardHeader title="Danger zone" />
            <div className="p-5">
              <p className="text-sm text-ink-2">
                Deleting the client removes its {sites.length} site{sites.length === 1 ? "" : "s"}, every audit, finding and fix proposal, and its Webflow connections. Nothing is changed in Webflow.
              </p>
              <form action={deleteClient} className="mt-3">
                <input type="hidden" name="clientId" value={client.id} />
                <ConfirmButton message={`Delete "${client.name}" and all of its audit history? This cannot be undone.`} className={btnDanger} pendingLabel="Deleting…">
                  Delete client
                </ConfirmButton>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
