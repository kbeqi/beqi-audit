import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { dbFromEnv, schema } from "@/db";
import type { User, UserRole } from "@/db/schema";
import { newId, nowIso, sha256Hex } from "@/lib/id";
import { getEnv } from "./env";

// Who is using the app, and how they get in.
//
// AUTH_MODE (wrangler.jsonc):
//   "app"    - in-app sign-in: a one-time email link creates a 30-day session
//              cookie; only team members (users table, or ADMIN_EMAILS) can
//              sign in. Default.
//   "access" - Cloudflare Access in front of the Worker; the identity header
//              is trusted and must belong to a team member.
//   "open"   - no sign-in (bring-up only; the UI shows a warning banner).
// Local dev: "app" mode is enforced exactly as in production (seed a row in
// login_tokens to sign in, or set AUTH_MODE=open in .dev.vars to skip sign-in;
// "open" on localhost signs you in as dev@local).

export const SESSION_COOKIE = "beqi_session";
const SESSION_DAYS = 30;
const LOGIN_TOKEN_MINUTES = 15;

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
  }
}

export class ForbiddenError extends Error {
  constructor(what = "This needs an admin.") {
    super(what);
  }
}

export interface Actor {
  email: string;
  name: string | null;
  role: UserRole;
  userId: string | null;
  via: "session" | "access" | "open" | "dev";
}

export function isLocalDev(env: Pick<CloudflareEnv, "APP_URL">): boolean {
  return !env.APP_URL || /localhost|127\.0\.0\.1/.test(env.APP_URL);
}

export function adminEmails(env: Pick<CloudflareEnv, "ADMIN_EMAILS">): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// A user row for an email that may sign in, creating the row for configured
// admins on first use. Null when the address is not on the team.
export async function userForEmail(env: Pick<CloudflareEnv, "DB" | "ADMIN_EMAILS">, rawEmail: string): Promise<User | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  const db = dbFromEnv(env);
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const configuredAdmin = adminEmails(env).includes(email);
  if (existing) {
    if (existing.disabledAt && !configuredAdmin) return null;
    if (configuredAdmin && (existing.role !== "admin" || existing.disabledAt)) {
      await db.update(schema.users).set({ role: "admin", disabledAt: null }).where(eq(schema.users.id, existing.id));
      return { ...existing, role: "admin", disabledAt: null };
    }
    return existing;
  }
  if (!configuredAdmin) return null;
  const row: typeof schema.users.$inferInsert = { id: newId(), email, role: "admin", invitedBy: "config", createdAt: nowIso() };
  await db.insert(schema.users).values(row);
  return (await db.query.users.findFirst({ where: eq(schema.users.email, email) })) ?? null;
}

// ---- sign-in links -----------------------------------------------------------

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Creates a one-time token for a team member. Returns null (silently) for
// unknown addresses and when one was issued less than a minute ago.
export async function createLoginToken(env: Pick<CloudflareEnv, "DB" | "ADMIN_EMAILS">, rawEmail: string): Promise<{ token: string; user: User } | null> {
  const user = await userForEmail(env, rawEmail);
  if (!user) return null;
  const db = dbFromEnv(env);
  const recent = await db.query.loginTokens.findFirst({
    where: and(eq(schema.loginTokens.email, user.email), gt(schema.loginTokens.createdAt, new Date(Date.now() - 60_000).toISOString())),
  });
  if (recent) return null;
  const token = randomToken();
  await db.insert(schema.loginTokens).values({
    id: newId(),
    email: user.email,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60_000).toISOString(),
  });
  return { token, user };
}

// Redeems a token and opens a session. Returns the raw session token for the cookie.
export async function redeemLoginToken(env: Pick<CloudflareEnv, "DB" | "ADMIN_EMAILS">, token: string, userAgent: string | null): Promise<{ sessionToken: string; user: User } | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const db = dbFromEnv(env);
  const hash = await sha256Hex(token);
  const row = await db.query.loginTokens.findFirst({ where: and(eq(schema.loginTokens.tokenHash, hash), isNull(schema.loginTokens.usedAt)) });
  if (!row || row.expiresAt < nowIso()) return null;
  const user = await userForEmail(env, row.email);
  if (!user) return null;
  await db.update(schema.loginTokens).set({ usedAt: nowIso() }).where(eq(schema.loginTokens.id, row.id));
  const sessionToken = randomToken();
  await db.insert(schema.sessions).values({
    id: newId(),
    userId: user.id,
    tokenHash: await sha256Hex(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
    userAgent: userAgent?.slice(0, 200) ?? null,
    lastSeenAt: nowIso(),
  });
  await db.update(schema.users).set({ lastLoginAt: nowIso() }).where(eq(schema.users.id, user.id));
  return { sessionToken, user };
}

export async function revokeSession(env: Pick<CloudflareEnv, "DB">, sessionToken: string | undefined): Promise<void> {
  if (!sessionToken) return;
  const db = dbFromEnv(env);
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, await sha256Hex(sessionToken)));
}

export async function revokeUserSessions(env: Pick<CloudflareEnv, "DB">, userId: string): Promise<void> {
  await dbFromEnv(env).delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: SESSION_DAYS * 86_400 };
}

async function userForSession(env: Pick<CloudflareEnv, "DB" | "ADMIN_EMAILS">, sessionToken: string | undefined): Promise<User | null> {
  if (!sessionToken || !/^[0-9a-f]{64}$/.test(sessionToken)) return null;
  const db = dbFromEnv(env);
  const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.tokenHash, await sha256Hex(sessionToken)) });
  if (!session || session.expiresAt < nowIso()) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
  if (!user || user.disabledAt) return null;
  // Touch at most once an hour to keep the write load trivial.
  if (!session.lastSeenAt || Date.now() - new Date(session.lastSeenAt).getTime() > 3_600_000) {
    await db.update(schema.sessions).set({ lastSeenAt: nowIso() }).where(eq(schema.sessions.id, session.id));
  }
  return user;
}

// ---- the actor for this request ----------------------------------------------

export async function currentActorOrNull(): Promise<Actor | null> {
  const env = await getEnv();
  const h = await headers();
  const mode = env.AUTH_MODE ?? "app";

  if (mode === "access") {
    const email = h.get("cf-access-authenticated-user-email");
    if (!email) return null;
    const user = await userForEmail(env, email);
    return user ? { email: user.email, name: user.name, role: user.role, userId: user.id, via: "access" } : null;
  }
  if (mode === "app") {
    const jar = await cookies();
    const user = await userForSession(env, jar.get(SESSION_COOKIE)?.value);
    return user ? { email: user.email, name: user.name, role: user.role, userId: user.id, via: "session" } : null;
  }
  // "open"
  if (isLocalDev(env)) return { email: "dev@local", name: "Local dev", role: "admin", userId: null, via: "dev" };
  return { email: "open-access", name: null, role: "admin", userId: null, via: "open" };
}

export async function currentActor(): Promise<string> {
  const actor = await currentActorOrNull();
  if (!actor) throw new UnauthenticatedError();
  return actor.email;
}

export async function requireAdmin(): Promise<Actor> {
  const actor = await currentActorOrNull();
  if (!actor) throw new UnauthenticatedError();
  if (actor.role !== "admin") throw new ForbiddenError();
  return actor;
}

// True when the deployment is reachable without any sign-in.
export async function isUnprotected(): Promise<boolean> {
  const env = await getEnv();
  return !isLocalDev(env) && (env.AUTH_MODE ?? "app") === "open";
}
