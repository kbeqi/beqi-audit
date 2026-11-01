import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv, appUrl } from "@/lib/env";
import { teamActor } from "@/lib/auth";
import { googleAuthorizeUrl, googleConfigured } from "@/lib/google/oauth";

export const GOOGLE_PENDING_COOKIE = "beqi_google_pending";

// GET /api/google/authorize?client=<clientId>
// Sends a Beqi team member (or the client, from their hub) to Google to grant
// read-only Search Console and GA4 access for one client.
export async function GET(request: Request) {
  await teamActor();
  const env = await getEnv();
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client");
  if (!clientId) return NextResponse.json({ error: "client is required" }, { status: 400 });
  if (!googleConfigured(env)) {
    return NextResponse.redirect(`${appUrl(env, request)}/clients/${clientId}/settings?error=${encodeURIComponent("Google sign-in isn't configured yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets).")}`);
  }
  const state = crypto.randomUUID();
  const redirectUri = `${appUrl(env, request)}/api/google/callback`;
  const jar = await cookies();
  jar.set(GOOGLE_PENDING_COOKIE, JSON.stringify({ clientId, state }), { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 600, path: "/" });
  return NextResponse.redirect(googleAuthorizeUrl(env, { redirectUri, state }));
}
