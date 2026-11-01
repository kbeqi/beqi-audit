import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { getEnv, appUrl } from "@/lib/env";
import { teamActor } from "@/lib/auth";
import { newId, nowIso } from "@/lib/id";
import { exchangeGoogleCode } from "@/lib/google/oauth";

const PENDING = "beqi_google_pending";

// OAuth redirect target for Google. Exchanges the code, records the
// connection (replacing any earlier one for the client) and sends the person
// to the client's Settings to pick properties per site.
export async function GET(request: Request) {
  const env = await getEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  let pending: { clientId: string; state: string } | null = null;
  try {
    pending = JSON.parse(jar.get(PENDING)?.value ?? "null");
  } catch {
    pending = null;
  }
  jar.delete(PENDING);
  const home = appUrl(env, request);
  if (!pending || !code || !state || state !== pending.state) {
    return NextResponse.redirect(`${home}/?error=${encodeURIComponent(url.searchParams.get("error") ?? "The Google sign-in did not complete. Try again.")}`);
  }
  const back = `${home}/clients/${pending.clientId}/settings`;
  const actor = (await teamActor()).email;
  const db = await getDb();
  try {
    const t = await exchangeGoogleCode(env, { code, redirectUri: `${home}/api/google/callback` });
    if (!t.refreshToken) throw new Error("Google did not return a refresh token; remove Beqi Audit under the Google account's third-party access and connect again.");
    // One active connection per client.
    await db.update(schema.googleConnections).set({ revokedAt: nowIso() }).where(eq(schema.googleConnections.clientId, pending.clientId));
    await db.insert(schema.googleConnections).values({
      id: newId(),
      clientId: pending.clientId,
      googleEmail: t.email,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: t.expiresAt,
      scopes: t.scopes,
      authorizedBy: actor,
    });
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "google.connected", detail: { clientId: pending.clientId, email: t.email } });
    return NextResponse.redirect(`${back}?notice=${encodeURIComponent(`Google connected${t.email ? ` as ${t.email}` : ""}. Now pick the Search Console and GA4 property for each site.`)}`);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "google.connect_failed", detail: { clientId: pending.clientId, error: message.slice(0, 300) } });
    return NextResponse.redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
}
