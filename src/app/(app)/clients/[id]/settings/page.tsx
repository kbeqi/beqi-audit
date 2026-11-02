import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeClient, requireTeam } from "@/app/gate";
import { clientDetail, primarySite, siteDetail } from "@/lib/queries";
import { SiteSettingsForm } from "@/components/site-settings-form";
import { listWebflowSites, siteBaseUrl } from "@/lib/webflow/mcp-client";
import { ensureFreshConnection } from "@/lib/webflow/mcp-oauth";
import { chooseSite, deleteClient, disconnectGoogle, disconnectWorkspace, reimportSites, removeClientLogo, sendMonthlyReportNow, sendTestEmail, sendTestSlack, updateClient, uploadClientLogo } from "@/app/actions";
import { googleConfigured } from "@/lib/google/oauth";
import { emailConfigured } from "@/lib/email";
import { appUrl, getEnv } from "@/lib/env";
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

export default async function ClientSettings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ClientSearch & { choose?: string }> }) {
  const { id } = await params;
  await requireTeam(`/clients/${id}/settings`);
  const q = await searchParams;
  const env = await getEnv();
  const mailReady = emailConfigured(env);
  const googleReady = googleConfigured(env);
  const data = await clientDetail(id);
  if (!data) notFound();
  const { client, sites, connections, googleConnection } = data;
  const site = primarySite(sites.map((s) => s.site));
  const detail = site ? await siteDetail(site.id) : null;
  const active = connections.filter((c) => !c.revokedAt);
  // The workspace has several sites and none is this client's yet: offer the list.
  const chooseFrom = q.choose ? active.find((c) => c.id === q.choose) : undefined;
  let choices: { id: string; name: string; host: string }[] = [];
  let chooseError: string | null = null;
  if (chooseFrom) {
    try {
      const fresh = await ensureFreshConnection(env, chooseFrom);
      choices = (await listWebflowSites(fresh.mcpServerUrl ?? env.WEBFLOW_MCP_URL, fresh.accessToken)).map((w) => ({ id: w.id, name: w.displayName, host: siteBaseUrl(w).replace(/^https?:\/\//, "") }));
    } catch (e) {
      chooseError = String((e as Error).message ?? e).slice(0, 200);
    }
  }
  const logoUrl = client.logoKey ? `/api/clients/${client.id}/logo?v=${encodeURIComponent(client.logoUpdatedAt ?? "")}` : null;

  return (
    <div className="space-y-6">
      <ClientNotices q={q} />
      {chooseFrom && (
        <Card>
          <CardHeader title="Which site is this client's?" description="The workspace has several sites. Each client has one; pick it and it is imported with its publish webhook." />
          {chooseError ? (
            <p className="p-5 text-sm text-critical-text">Could not list the workspace&apos;s sites: {chooseError}</p>
          ) : (
            <ul className="divide-y divide-line">
              {choices.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="text-xs text-ink-3">{c.host}</div>
                  </div>
                  <form action={chooseSite}>
                    <input type="hidden" name="connectionId" value={chooseFrom.id} />
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="webflowSiteId" value={c.id} />
                    <SubmitButton className={`${btnPrimary} ${btnSm}`} pendingLabel="Importing…">
                      This one
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {site && detail && <SiteSettingsForm site={site} ignoreRules={detail.ignoreRules} googleConnection={googleConnection} />}
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
                <label className="mt-2 flex items-start gap-2 text-sm text-ink-2">
                  <input name="notifyMonthly" type="checkbox" defaultChecked={client.notifyMonthly} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-ink">Monthly progress report</span>
                    <span className="block text-xs text-ink-3">On the 1st: scores then and now, fixes applied, issues resolved, what is waiting for approval. Also posted to Slack when connected.</span>
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
                <p className="mt-1 text-xs text-ink-3">Audit results, applied fixes and the monthly report are posted to this channel (the client&apos;s shared channel, or an internal one). Leave empty for none.</p>
              </fieldset>
              <SubmitButton className={btnPrimary} pendingLabel="Saving…">
                Save changes
              </SubmitButton>
            </form>
            {client.slackWebhookUrl && (
              <form action={sendTestSlack} className="border-t border-line px-5 py-3">
                <input type="hidden" name="clientId" value={client.id} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-ink-2">Slack channel connected</span>
                  <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Posting…">
                    Post a test message
                  </SubmitButton>
                </div>
              </form>
            )}
            {(client.notifyEmail || client.slackWebhookUrl) && (
              <form action={sendMonthlyReportNow} className="border-t border-line px-5 py-3">
                <input type="hidden" name="clientId" value={client.id} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-ink-2">Last month&apos;s progress report, sent now</span>
                  <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Sending…" confirm="Send last month's progress report to the client's email and Slack now?">
                    Send monthly report
                  </SubmitButton>
                </div>
              </form>
            )}
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
              <EmptyState title="Not connected" body="A Beqi team member with access to the client's workspace authorizes it once; the client's site is imported from it. No Webflow app install is needed." />
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
                          <SubmitButton className={`${btnSecondary} ${btnSm}`} title="Read the workspace again and re-link the client's site" pendingLabel="Importing…">
                            Re-import
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
            <CardHeader
              title="Google: Search Console + GA4"
              description="Read-only access to measure clicks, visits and AI referrals, and what changed after each fix"
              actions={
                googleReady ? (
                  // A plain anchor: a prefetch would start the OAuth flow.
                  <a href={`/api/google/authorize?client=${client.id}`} className={`${googleConnection ? btnSecondary : btnPrimary} ${btnSm}`}>
                    {googleConnection ? "Connect a different account" : "Connect Google"}
                  </a>
                ) : undefined
              }
            />
            {!googleReady ? (
              <div className="p-5 text-sm text-ink-2">
                <p>Google sign-in isn&apos;t configured on this deployment yet. One-time setup by Beqi:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-3">
                  <li>Google Cloud console → APIs &amp; Services → enable the Search Console API, Google Analytics Admin API and Google Analytics Data API.</li>
                  <li>Credentials → Create OAuth client (Web application) with the redirect URI <span className="font-mono text-ink-2">{`${appUrl(env)}/api/google/callback`}</span>.</li>
                  <li>
                    <span className="font-mono text-ink-2">wrangler secret put GOOGLE_CLIENT_ID</span> and <span className="font-mono text-ink-2">GOOGLE_CLIENT_SECRET</span>, then redeploy.
                  </li>
                </ol>
              </div>
            ) : googleConnection ? (
              <div className="p-5 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">{googleConnection.googleEmail ?? "Google account"}</div>
                    <div className="text-xs text-ink-3">
                      by {googleConnection.authorizedBy ?? "—"} · {fmtDay(googleConnection.createdAt)} · {site && (site.gscProperty || site.ga4Property) ? "properties linked" : "no property linked yet"}
                    </div>
                  </div>
                  <form action={disconnectGoogle}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <ConfirmButton message="Disconnect Google? Synced data stays; nothing new is pulled until it is connected again." className={`${btnDanger} ${btnSm}`} pendingLabel="Disconnecting…">
                      Disconnect
                    </ConfirmButton>
                  </form>
                </div>
                <p className="mt-2 text-xs text-ink-3">
                  Pick the Search Console and GA4 property in the{" "}
                  <Link href="#site" className="text-accent underline">
                    Site settings
                  </Link>{" "}
                  on the left. The account needs at least read access to those properties; the client&apos;s own account, or a Beqi account they added, both work.
                </p>
              </div>
            ) : (
              <EmptyState title="Not connected" body="Sign in with the client's Google account (or a Beqi account that has access to their Search Console and GA4). Only read scopes are requested." />
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
                Deleting the client removes its site, every audit, finding and fix proposal, and its Webflow and Google connections. Nothing is changed in Webflow.
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
