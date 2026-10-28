import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { SESSION_COOKIE, redeemLoginToken, sessionCookieOptions } from "@/lib/auth";
import { appUrl, getEnv } from "@/lib/env";
import { newId } from "@/lib/id";

// Target of the sign-in email link. Redeems the one-time token and sets the
// session cookie.
export async function GET(request: Request) {
  const env = await getEnv();
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const base = appUrl(env, request);

  const result = await redeemLoginToken(env, token, request.headers.get("user-agent"));
  if (!result) {
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent("That sign-in link is invalid or has expired. Request a new one.")}`);
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions(url.protocol === "https:"));
  const db = await getDb();
  await db.insert(schema.auditLog).values({ id: newId(), actor: result.user.email, action: "auth.signed_in", detail: { via: "email_link" } });
  return NextResponse.redirect(`${base}${safeNext}`);
}
