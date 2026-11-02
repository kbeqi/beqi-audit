// Google sign-in for Search Console and GA4, read-only. A plain OAuth 2.0
// authorization-code flow against Google's endpoints; the app's own OAuth
// client comes from the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets
// (Google Cloud console → APIs & Services → Credentials → OAuth client,
// web application, redirect URI <APP_URL>/api/google/callback).

import { eq } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import type { GoogleConnection } from "@/db/schema";

export type GoogleEnv = Pick<CloudflareEnv, "DB" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">;

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/userinfo.email"];

const REFRESH_WHEN_LESS_THAN_MS = 5 * 60_000;

export function googleConfigured(env: Pick<CloudflareEnv, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthorizeUrl(env: GoogleEnv, opts: { redirectUri: string; state: string }): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  // Always ask, so a refresh token comes back even when the account already granted access once.
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", opts.state);
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(env: GoogleEnv, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error) throw new Error(`Google token error: ${body.error ?? res.status}${body.error_description ? ` (${body.error_description})` : ""}`);
  return body;
}

export async function exchangeGoogleCode(env: GoogleEnv, opts: { code: string; redirectUri: string }): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string; email: string | null }> {
  const t = await tokenRequest(env, { code: opts.code, redirect_uri: opts.redirectUri, grant_type: "authorization_code" });
  const email = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } })
    .then((r): Promise<{ email?: string }> => (r.ok ? r.json() : Promise.resolve({})))
    .then((j) => j.email ?? null)
    .catch(() => null);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    scopes: t.scope ?? GOOGLE_SCOPES.join(" "),
    email,
  };
}

// A connection whose access token is good for at least a few minutes,
// refreshing (and saving) when needed. A refresh rejected by Google marks the
// connection revoked so the UI asks for a reconnect.
export async function freshGoogleConnection(env: GoogleEnv, connection: GoogleConnection): Promise<GoogleConnection> {
  if (new Date(connection.expiresAt).getTime() - Date.now() > REFRESH_WHEN_LESS_THAN_MS) return connection;
  if (!connection.refreshToken) throw new Error("Google connection has no refresh token; connect it again.");
  const db = dbFromEnv(env);
  try {
    const t = await tokenRequest(env, { refresh_token: connection.refreshToken, grant_type: "refresh_token" });
    const expiresAt = new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
    await db.update(schema.googleConnections).set({ accessToken: t.access_token, expiresAt }).where(eq(schema.googleConnections.id, connection.id));
    return { ...connection, accessToken: t.access_token, expiresAt };
  } catch (e) {
    if (/invalid_grant/.test(String((e as Error).message))) {
      await db.update(schema.googleConnections).set({ revokedAt: new Date().toISOString() }).where(eq(schema.googleConnections.id, connection.id));
    }
    throw e;
  }
}

// The active Google connection for a client, fresh, or null when none.
export async function googleConnectionForClient(env: GoogleEnv, clientId: string): Promise<GoogleConnection | null> {
  const db = dbFromEnv(env);
  const rows = await db.query.googleConnections.findMany({ where: eq(schema.googleConnections.clientId, clientId) });
  const active = rows.filter((r) => !r.revokedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!active) return null;
  return freshGoogleConnection(env, active);
}
