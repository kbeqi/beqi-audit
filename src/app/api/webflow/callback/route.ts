import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { getEnv, appUrl } from "@/lib/env";
import { currentActor } from "@/lib/auth";
import { newId, nowIso } from "@/lib/id";
import { PENDING_COOKIE, completeMcpAuthorization, decodePending, expiresAtFrom } from "@/lib/webflow/mcp-oauth";
import { listWebflowSites, siteBaseUrl } from "@/lib/webflow/mcp-client";
import { nextRunAfter } from "@/audit/start";

// OAuth redirect target. Exchanges the code with Webflow's MCP server, records
// the connection, and imports every site the token can see under the client.
export async function GET(request: Request) {
  const env = await getEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const pending = decodePending(jar.get(PENDING_COOKIE)?.value);
  jar.delete(PENDING_COOKIE);

  if (!code || !state || !pending || state !== pending.state) {
    return NextResponse.redirect(`${appUrl(env, request)}/?error=${encodeURIComponent("The Webflow authorization did not complete (state mismatch). Try again.")}`);
  }
  const clientId = pending.clientId;
  const back = `${appUrl(env, request)}/clients/${clientId}`;
  const actor = await currentActor();
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) return NextResponse.redirect(`${appUrl(env, request)}/?error=client_not_found`);

  try {
    const { tokens, clientInfo } = await completeMcpAuthorization({ pending, code });
    const sites = await listWebflowSites(pending.serverUrl, tokens.access_token);

    const connectionId = newId();
    await db.insert(schema.webflowConnections).values({
      id: connectionId,
      clientId,
      label: sites[0]?.workspaceId ? `Workspace ${sites[0].workspaceId.slice(-6)}` : "Webflow workspace",
      workspaceId: sites[0]?.workspaceId ?? null,
      authKind: "mcp_oauth",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: expiresAtFrom(tokens),
      scopes: tokens.scope ?? "",
      mcpServerUrl: pending.serverUrl,
      mcpClientId: clientInfo?.client_id ?? pending.mcpClientId,
      mcpClientSecret: clientInfo?.client_secret ?? pending.mcpClientSecret,
      authorizedSiteIds: sites.map((s) => s.id),
      authorizedBy: actor,
    });

    // Import sites. Existing rows (re-authorization) keep their settings and
    // history and are re-pointed at the new connection.
    let imported = 0;
    for (const s of sites) {
      const existing = await db.query.sites.findFirst({ where: eq(schema.sites.webflowSiteId, s.id) });
      if (existing) {
        await db.update(schema.sites).set({ connectionId, name: s.displayName, shortName: s.shortName, previewUrl: s.previewUrl ?? null }).where(eq(schema.sites.id, existing.id));
      } else {
        await db.insert(schema.sites).values({
          id: newId(),
          clientId,
          connectionId,
          webflowSiteId: s.id,
          name: s.displayName,
          shortName: s.shortName,
          baseUrl: siteBaseUrl(s),
          previewUrl: s.previewUrl ?? null,
          auditFrequency: "weekly",
          nextRunAt: nextRunAfter("weekly"),
        });
      }
      imported++;
    }
    await db.insert(schema.auditLog).values({
      id: newId(),
      actor,
      action: "webflow.connected",
      detail: { clientId, connectionId, sites: imported, expiresAt: expiresAtFrom(tokens), at: nowIso() },
    });
    return NextResponse.redirect(`${back}?connected=${imported}`);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "webflow.connect_failed", detail: { clientId, error: message.slice(0, 500) } });
    return NextResponse.redirect(`${back}?error=${encodeURIComponent(message.slice(0, 200))}`);
  }
}
