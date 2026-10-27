import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getEnv, appUrl } from "@/lib/env";
import { currentActor } from "@/lib/auth";
import { newId, nowIso } from "@/lib/id";
import { exchangeCode } from "@/lib/webflow/oauth";
import { siteBaseUrl, webflow } from "@/lib/webflow/client";
import { nextRunAfter } from "@/audit/start";

// OAuth redirect target. Exchanges the code, records the connection, imports
// every authorized site under the client, and registers a site_publish webhook.
export async function GET(request: Request) {
  const env = await getEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("wf_oauth_state")?.value;
  jar.delete("wf_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(`${appUrl(env, request)}/?error=oauth_state`);
  }
  if (!env.WEBFLOW_CLIENT_ID || !env.WEBFLOW_CLIENT_SECRET) {
    return NextResponse.json({ error: "Webflow OAuth is not configured" }, { status: 500 });
  }
  const clientId = state.split(".")[0];
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) return NextResponse.redirect(`${appUrl(env, request)}/?error=unknown_client`);

  const token = await exchangeCode({
    clientId: env.WEBFLOW_CLIENT_ID,
    clientSecret: env.WEBFLOW_CLIENT_SECRET,
    code,
    redirectUri: `${appUrl(env, request)}/api/webflow/callback`,
  });
  const info = await webflow.tokenInfo(token.access_token);
  const sites = await webflow.listSites(token.access_token);
  const actor = await currentActor();

  const connectionId = newId();
  await db.insert(schema.webflowConnections).values({
    id: connectionId,
    clientId: client.id,
    workspaceId: info.authorization.authorizedTo.workspaceIds[0] ?? sites[0]?.workspaceId ?? null,
    accessToken: token.access_token,
    scopes: token.scope ?? "",
    authorizedSiteIds: sites.map((s) => s.id),
    authorizedBy: actor,
  });

  const webhookUrl = `${appUrl(env, request)}/api/webhooks/webflow`;
  for (const s of sites) {
    const existing = await db.query.sites.findFirst({ where: eq(schema.sites.webflowSiteId, s.id) });
    if (existing) {
      await db.update(schema.sites).set({ connectionId, name: s.displayName, shortName: s.shortName, baseUrl: siteBaseUrl(s), previewUrl: s.previewUrl ?? null }).where(eq(schema.sites.id, existing.id));
    } else {
      await db.insert(schema.sites).values({
        id: newId(),
        clientId: client.id,
        connectionId,
        webflowSiteId: s.id,
        name: s.displayName,
        shortName: s.shortName,
        baseUrl: siteBaseUrl(s),
        previewUrl: s.previewUrl ?? null,
        auditFrequency: "weekly",
        nextRunAt: nextRunAfter("weekly"),
        keyPages: ["/"],
      });
    }
    // Publish-triggered runs. Ignore failures (e.g. missing scope) — the schedule still works.
    try {
      const hooks = await webflow.listWebhooks(token.access_token, s.id);
      if (!hooks.some((h) => h.triggerType === "site_publish" && h.url === webhookUrl)) {
        await webflow.createWebhook(token.access_token, s.id, "site_publish", webhookUrl);
      }
    } catch (e) {
      console.warn(`webhook registration failed for ${s.id}:`, (e as Error).message);
    }
  }

  await db.insert(schema.auditLog).values({ id: newId(), siteId: null, actor, action: "webflow.connected", detail: { clientId: client.id, sites: sites.map((s) => s.id), at: nowIso() } });
  return NextResponse.redirect(`${appUrl(env, request)}/clients/${client.id}?connected=${sites.length}`);
}
