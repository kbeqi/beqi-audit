import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv, appUrl } from "@/lib/env";
import { authorizeUrl } from "@/lib/webflow/oauth";
import { newId } from "@/lib/id";

// GET /api/webflow/authorize?client=<clientId>
// Sends the user to Webflow to grant the Beqi app access to one workspace or
// a set of sites. The client id rides along in the OAuth state.
export async function GET(request: Request) {
  const env = await getEnv();
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client");
  if (!clientId) return NextResponse.json({ error: "client is required" }, { status: 400 });
  if (!env.WEBFLOW_CLIENT_ID) return NextResponse.json({ error: "WEBFLOW_CLIENT_ID is not configured" }, { status: 500 });

  const state = `${clientId}.${newId()}`;
  const jar = await cookies();
  jar.set("wf_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 600, path: "/" });

  return NextResponse.redirect(
    authorizeUrl({ clientId: env.WEBFLOW_CLIENT_ID, redirectUri: `${appUrl(env, request)}/api/webflow/callback`, state }),
  );
}
