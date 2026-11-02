import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv, appUrl } from "@/lib/env";
import { teamActor } from "@/lib/auth";
import { PENDING_COOKIE, beginMcpAuthorization, encodePending } from "@/lib/webflow/mcp-oauth";

// GET /api/webflow/authorize?client=<clientId>
// Sends a Beqi team member to Webflow to authorize the app's access to one
// workspace through Webflow's MCP server. The client id rides along in the state.
export async function GET(request: Request) {
  const env = await getEnv();
  // A signed-out or client-role visitor is sent to sign in, not shown an error.
  try {
    await teamActor();
  } catch {
    return NextResponse.redirect(`${appUrl(env, request)}/login?next=${encodeURIComponent("/clients")}`);
  }
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client");
  if (!clientId) return NextResponse.json({ error: "client is required" }, { status: 400 });

  const redirectUri = `${appUrl(env, request)}/api/webflow/callback`;
  try {
    const { authorizationUrl, pending } = await beginMcpAuthorization(env, { clientId, redirectUri });
    const jar = await cookies();
    jar.set(PENDING_COOKIE, encodePending(pending), { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 600, path: "/" });
    return NextResponse.redirect(authorizationUrl);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    return NextResponse.redirect(`${appUrl(env, request)}/clients/${clientId}?error=${encodeURIComponent(message)}`);
  }
}
