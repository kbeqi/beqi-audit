// Imports (or refreshes) the sites a Webflow connection can see. Existing site
// rows keep their settings and history and are re-pointed at the connection.
// Each imported site also gets a site_publish webhook pointing back at this
// app, so a publish starts a check (release assurance).

import { eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Site, WebflowConnection } from "@/db/schema";
import { newId, randomToken } from "@/lib/id";
import { appUrl } from "@/lib/env";
import { nextRunAfter } from "@/audit/start";
import { WebflowSession, listWebflowSites, siteBaseUrl, type McpSite } from "./mcp-client";

type ImportEnv = Pick<CloudflareEnv, "WEBFLOW_MCP_URL" | "APP_URL">;

// One site per client. The workspace's site list is read; the client's site is
// the one already on record (re-linked), the only site in the workspace, or the
// one chosen (`chooseWebflowSiteId`) when the workspace has several. In that
// last case nothing is imported and `choices` lists the options.
export async function importSitesForConnection(db: Db, connection: WebflowConnection, env: ImportEnv, chooseWebflowSiteId?: string): Promise<{ imported: number; workspaceId: string | null; webhooks: number; choices: McpSite[] }> {
  const all = await listWebflowSites(connection.mcpServerUrl ?? env.WEBFLOW_MCP_URL, connection.accessToken);
  const current = await db.query.sites.findMany({ where: eq(schema.sites.clientId, connection.clientId) });
  let sites: McpSite[];
  if (chooseWebflowSiteId) sites = all.filter((s) => s.id === chooseWebflowSiteId);
  else if (current.some((c) => all.some((s) => s.id === c.webflowSiteId))) sites = all.filter((s) => current.some((c) => c.webflowSiteId === s.id)).slice(0, 1);
  else if (all.length === 1) sites = all;
  else sites = [];
  const choices = sites.length === 0 && all.length > 1 ? all : [];
  await db
    .update(schema.webflowConnections)
    .set({ authorizedSiteIds: all.map((s) => s.id), workspaceId: all[0]?.workspaceId ?? connection.workspaceId, label: all[0]?.workspaceId ? `Workspace ${all[0].workspaceId.slice(-6)}` : connection.label })
    .where(eq(schema.webflowConnections.id, connection.id));
  let imported = 0;
  const rows: Site[] = [];
  for (const s of sites) {
    const existing = await db.query.sites.findFirst({ where: eq(schema.sites.webflowSiteId, s.id) });
    if (existing) {
      await db
        .update(schema.sites)
        .set({ connectionId: connection.id, name: s.displayName, shortName: s.shortName, previewUrl: s.previewUrl ?? null })
        .where(eq(schema.sites.id, existing.id));
      rows.push({ ...existing, connectionId: connection.id, name: s.displayName, shortName: s.shortName, previewUrl: s.previewUrl ?? null });
    } else {
      const id = newId();
      await db.insert(schema.sites).values({
        id,
        clientId: connection.clientId,
        connectionId: connection.id,
        webflowSiteId: s.id,
        name: s.displayName,
        shortName: s.shortName,
        baseUrl: siteBaseUrl(s),
        previewUrl: s.previewUrl ?? null,
        auditFrequency: "weekly",
        nextRunAt: nextRunAfter("weekly"),
        maxPages: 40,
      });
      const created = await db.query.sites.findFirst({ where: eq(schema.sites.id, id) });
      if (created) rows.push(created);
    }
    imported++;
  }
  const workspaceId = all[0]?.workspaceId ?? null;

  // Publish webhooks: best effort, one session for all sites. A failure here
  // never fails the import; saving the site's settings retries it.
  let webhooks = 0;
  const needing = rows.filter((r) => r.auditOnPublish && !r.webhookId);
  if (needing.length && !appUrl(env).includes("localhost")) {
    let session: WebflowSession | null = null;
    try {
      session = await WebflowSession.open(connection.mcpServerUrl ?? env.WEBFLOW_MCP_URL, connection.accessToken);
      for (const site of needing) {
        try {
          await registerWebhook(db, session, site, env);
          webhooks++;
        } catch (e) {
          await db.insert(schema.auditLog).values({ id: newId(), siteId: site.id, actor: "system", action: "webflow.webhook_failed", detail: { error: String((e as Error).message ?? e).slice(0, 300) } });
        }
      }
    } catch (e) {
      await db.insert(schema.auditLog).values({ id: newId(), actor: "system", action: "webflow.webhook_failed", detail: { connectionId: connection.id, error: String((e as Error).message ?? e).slice(0, 300) } });
    } finally {
      await session?.close();
    }
  }
  return { imported, workspaceId, webhooks, choices };
}

// Registers (once) the site_publish webhook for one site.
export async function ensurePublishWebhook(db: Db, connection: WebflowConnection, site: Site, env: ImportEnv): Promise<boolean> {
  if (site.webhookId) return false;
  if (appUrl(env).includes("localhost")) return false;
  const session = await WebflowSession.open(connection.mcpServerUrl ?? env.WEBFLOW_MCP_URL, connection.accessToken);
  try {
    await registerWebhook(db, session, site, env);
    return true;
  } catch (e) {
    await db.insert(schema.auditLog).values({ id: newId(), siteId: site.id, actor: "system", action: "webflow.webhook_failed", detail: { error: String((e as Error).message ?? e).slice(0, 300) } });
    throw e;
  } finally {
    await session.close();
  }
}

export function webhookUrl(env: Pick<CloudflareEnv, "APP_URL">, siteId: string, secret: string): string {
  return `${appUrl(env)}/api/webhooks/webflow/${siteId}/${secret}`;
}

async function registerWebhook(db: Db, session: WebflowSession, site: Site, env: ImportEnv): Promise<void> {
  const secret = randomToken(24);
  const url = webhookUrl(env, site.id, secret);
  const text = await session.call(
    "data_webhook_tool",
    { actions: [{ label: "publish-hook", create_webhook: { site_id: site.webflowSiteId, trigger_type: "site_publish", url } }] },
    "Beqi Audit registers a site publish webhook so each publish of this site can be checked for regressions.",
  );
  const id = /"id"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;
  if (!id) throw new Error(`Webflow did not return a webhook id: ${text.slice(0, 200)}`);
  await db.update(schema.sites).set({ webhookId: id, webhookSecret: secret }).where(eq(schema.sites.id, site.id));
  await db.insert(schema.auditLog).values({ id: newId(), siteId: site.id, actor: "system", action: "webflow.webhook_registered", detail: { webhookId: id } });
}
