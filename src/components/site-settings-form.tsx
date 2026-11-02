import type { GoogleConnection, IgnoreRule, Site } from "@/db/schema";
import { AI_SAMPLE_LABELS, FREQUENCY_LABELS, type AiSampleEvery, type AuditFrequency } from "@/db/schema";
import { adoptAiPrompt, deleteIgnoreRule, updateSiteSettings } from "@/app/actions";
import { listGa4Properties, listGscSites, type Ga4Property, type GscSite } from "@/lib/google/api";
import { freshGoogleConnection } from "@/lib/google/oauth";
import { getEnv } from "@/lib/env";
import { SubmitButton } from "./submit-button";
import { Card, CardHeader, btnPrimary, btnSecondary, btnSm, inputCls, labelCls } from "./ui";

// The client's one site: schedule, pages, publish check, AI answers check and
// Google properties. Lives on the client's Settings tab (team only).
export async function SiteSettingsForm({ site, ignoreRules, googleConnection }: { site: Site; ignoreRules: IgnoreRule[]; googleConnection: GoogleConnection | null }) {
  // Property lists read live from Google when connected; a failure only means
  // typing the id by hand.
  const googleLists = googleConnection ? await loadGoogleLists(googleConnection) : null;
  const candidates = (site.aiPromptCandidates ?? []).filter((c) => !(site.aiPrompts ?? []).includes(c));
  return (
    <Card id="site">
      <CardHeader title="Site" description={`${site.name} · how it is audited and measured`} />
      <form action={updateSiteSettings} className="space-y-3 p-5 text-sm">
        <input type="hidden" name="siteId" value={site.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="auditFrequency" className={labelCls}>
              Audit schedule
            </label>
            <select id="auditFrequency" name="auditFrequency" defaultValue={site.auditFrequency} className={inputCls}>
              {(Object.keys(FREQUENCY_LABELS) as AuditFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="baseUrl" className={labelCls}>
              Live URL
            </label>
            <input id="baseUrl" name="baseUrl" defaultValue={site.baseUrl} className={inputCls} />
          </div>
        </div>
        <div>
          <label htmlFor="keyPages" className={labelCls}>
            Key pages (always reviewed first; one per line)
          </label>
          <textarea id="keyPages" name="keyPages" rows={3} defaultValue={site.keyPages.join("\n")} className={inputCls} />
        </div>
        <div>
          <label htmlFor="maxPages" className={labelCls}>
            Pages to review per audit (5–200)
          </label>
          <input id="maxPages" name="maxPages" type="number" min={5} max={200} defaultValue={site.maxPages} className={inputCls} />
          <p className="mt-1 text-xs text-ink-3">More pages means a longer, costlier audit. 40 covers most marketing sites.</p>
        </div>
        <label className="flex items-start gap-2 text-ink-2">
          <input name="auditOnPublish" type="checkbox" defaultChecked={site.auditOnPublish} className="mt-0.5" />
          <span>
            <span className="font-medium text-ink">Check the site after each publish</span>
            <span className="block text-xs text-ink-3">
              Webflow tells the app when the site is published; an audit runs and reports what changed. {site.webhookId ? "Webhook registered." : site.auditOnPublish ? "Webhook not registered yet; saving registers it." : ""}
            </span>
          </span>
        </label>
        <div>
          <label htmlFor="aiSampleEvery" className={labelCls}>
            AI answers check
          </label>
          <select id="aiSampleEvery" name="aiSampleEvery" defaultValue={site.aiSampleEvery} className={inputCls}>
            {(Object.keys(AI_SAMPLE_LABELS) as AiSampleEvery[]).map((k) => (
              <option key={k} value={k}>
                {AI_SAMPLE_LABELS[k]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">Monthly matches the report cadence and keeps the cost down; answers vary day to day, so more often adds noise, not signal.{site.aiSampledFor ? ` Last check: ${site.aiSampledFor}.` : ""}</p>
        </div>
        <div>
          <label htmlFor="aiPrompts" className={labelCls}>
            Questions for the AI answers check (one per line, up to 15)
          </label>
          <textarea id="aiPrompts" name="aiPrompts" rows={4} defaultValue={site.aiPrompts?.join("\n") ?? ""} placeholder={"best Webflow agency in Tirana\nhow much does a Webflow site cost"} className={inputCls} />
          <p className="mt-1 text-xs text-ink-3">The frozen set, agreed with the client, so month-to-month results compare like with like. Empty means the audit writes its own questions each time (noisier).</p>
        </div>
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Google measurement</legend>
          {googleConnection ? (
            <p className="mb-2 text-xs text-ink-3">Connected as {googleConnection.googleEmail ?? "a Google account"}. Pick the properties that belong to this site; the last 120 days are pulled right after saving.</p>
          ) : (
            <p className="mb-2 text-xs text-ink-3">Connect the client&apos;s Google account first (right), then pick the properties here.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="gscProperty" className={labelCls}>
                Search Console property
              </label>
              {googleLists?.gsc.length ? (
                <select id="gscProperty" name="gscProperty" defaultValue={site.gscProperty ?? ""} className={inputCls}>
                  <option value="">Not linked</option>
                  {googleLists.gsc.map((g) => (
                    <option key={g.siteUrl} value={g.siteUrl}>
                      {g.siteUrl}
                    </option>
                  ))}
                  {site.gscProperty && !googleLists.gsc.some((g) => g.siteUrl === site.gscProperty) && <option value={site.gscProperty}>{site.gscProperty} (not visible to this account)</option>}
                </select>
              ) : (
                <input id="gscProperty" name="gscProperty" defaultValue={site.gscProperty ?? ""} placeholder="sc-domain:example.com" className={inputCls} />
              )}
            </div>
            <div>
              <label htmlFor="ga4Property" className={labelCls}>
                GA4 property
              </label>
              {googleLists?.ga4.length ? (
                <select id="ga4Property" name="ga4Property" defaultValue={site.ga4Property ?? ""} className={inputCls}>
                  <option value="">Not linked</option>
                  {googleLists.ga4.map((g) => (
                    <option key={g.property} value={g.property}>
                      {g.displayName} ({g.account})
                    </option>
                  ))}
                  {site.ga4Property && !googleLists.ga4.some((g) => g.property === site.ga4Property) && <option value={site.ga4Property}>{site.ga4Property} (not visible to this account)</option>}
                </select>
              ) : (
                <input id="ga4Property" name="ga4Property" defaultValue={site.ga4Property ?? ""} placeholder="properties/123456789" className={inputCls} />
              )}
            </div>
          </div>
          {googleLists?.error && <p className="mt-2 text-xs text-critical-text">Could not list properties: {googleLists.error}</p>}
        </fieldset>
        <label className="flex items-center gap-2 text-ink-2">
          <input name="isEnterprise" type="checkbox" defaultChecked={site.isEnterprise} />
          Enterprise plan (Analyze / AEO analytics available)
        </label>
        <SubmitButton className={btnPrimary} pendingLabel="Saving…">
          Save site settings
        </SubmitButton>
      </form>

      {candidates.length > 0 && (
        <div className="border-t border-line p-5">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Questions suggested by the latest audit</h3>
          <p className="mb-2 text-xs text-ink-3">Add the ones worth tracking to the set above; the set stays as it is otherwise.</p>
          <ul className="space-y-1.5 text-sm">
            {candidates.map((c) => (
              <li key={c} className="flex items-center justify-between gap-2">
                <span className="text-ink-2">“{c}”</span>
                <form action={adoptAiPrompt}>
                  <input type="hidden" name="siteId" value={site.id} />
                  <input type="hidden" name="prompt" value={c} />
                  <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Adding…" disabled={(site.aiPrompts?.length ?? 0) >= 15}>
                    Add
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ignoreRules.length > 0 && (
        <div className="border-t border-line p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Ignore rules</h3>
          <ul className="space-y-1.5 text-xs">
            {ignoreRules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-ink-2">
                  {r.checkId} {r.pagePath ? `on ${r.pagePath}` : "(whole site)"}
                </span>
                <form action={deleteIgnoreRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="siteId" value={site.id} />
                  <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

async function loadGoogleLists(connection: GoogleConnection): Promise<{ gsc: GscSite[]; ga4: Ga4Property[]; error: string | null }> {
  try {
    const fresh = await freshGoogleConnection(await getEnv(), connection);
    const [gsc, ga4] = await Promise.all([listGscSites(fresh.accessToken).catch(() => [] as GscSite[]), listGa4Properties(fresh.accessToken).catch(() => [] as Ga4Property[])]);
    return { gsc, ga4, error: null };
  } catch (e) {
    return { gsc: [], ga4: [], error: String((e as Error).message ?? e).slice(0, 200) };
  }
}
