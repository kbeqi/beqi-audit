import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { getEnv, appUrl } from "@/lib/env";
import { currentActor } from "@/lib/auth";
import { newId, nowIso } from "@/lib/id";
import { PENDING_COOKIE, completeMcpAuthorization, decodePending, expiresAtFrom } from "@/lib/webflow/mcp-oauth";
import { importSitesForConnection } from "@/lib/webflow/import";

// OAuth redirect target. Exchanges the code with Webflow's MCP server, records
// the connection, then imports every site the token can see under the client.
// The connection is saved before the import so an import problem never costs
// the user their authorization; "Re-import sites" on the client page retries it.
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

  let connectionId: string | null = null;
  try {
    const { tokens, clientInfo } = await completeMcpAuthorization({ pending, code });
    connectionId = newId();
    await db.insert(schema.webflowConnections).values({
      id: connectionId,
      clientId,
      label: "Webflow workspace",
      authKind: "mcp_oauth",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: expiresAtFrom(tokens),
      scopes: tokens.scope ?? "",
      mcpServerUrl: pending.serverUrl,
      mcpClientId: clientInfo?.client_id ?? pending.mcpClientId,
      mcpClientSecret: clientInfo?.client_secret ?? pending.mcpClientSecret,
      authorizedSiteIds: [],
      authorizedBy: actor,
    });
    await db.insert(schema.auditLog).values({
      id: newId(),
      actor,
      action: "webflow.connected",
      detail: { clientId, connectionId, expiresAt: expiresAtFrom(tokens), at: nowIso() },
    });
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "webflow.connect_failed", detail: { clientId, error: message.slice(0, 500) } });
    return NextResponse.redirect(`${back}?error=${encodeURIComponent(message.slice(0, 200))}`);
  }

  try {
    const connection = (await db.query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, connectionId) }))!;
    const { imported } = await importSitesForConnection(db, connection, env);
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "webflow.sites_imported", detail: { clientId, connectionId, sites: imported } });
    return NextResponse.redirect(`${back}?connected=${imported}`);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "webflow.import_failed", detail: { clientId, connectionId, error: message.slice(0, 500) } });
    return NextResponse.redirect(`${back}?error=${encodeURIComponent(`Connected, but importing sites failed: ${message.slice(0, 160)}. Use "Re-import sites".`)}`);
  }
}
