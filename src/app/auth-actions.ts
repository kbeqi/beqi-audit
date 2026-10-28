"use server";

import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import type { UserRole } from "@/db/schema";
import { SESSION_COOKIE, adminEmails, createLoginToken, currentActor, normalizeEmail, requireAdmin, revokeSession, revokeUserSessions } from "@/lib/auth";
import { loginEmail, sendEmail } from "@/lib/email";
import { appUrl, getCtx } from "@/lib/env";
import { newId, nowIso } from "@/lib/id";

async function log(actor: string, action: string, detail: Record<string, unknown>) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ id: newId(), actor, action, detail });
}

// Sends a one-time sign-in link. Unknown addresses get the same screen.
export async function requestSignIn(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const next = String(formData.get("next") ?? "");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/login?error=${encodeURIComponent("Enter a valid email address.")}`);
  const { env } = await getCtx();
  const issued = await createLoginToken(env, email);
  if (issued) {
    const link = `${appUrl(env)}/api/auth/callback?token=${issued.token}&next=${encodeURIComponent(safeNext)}`;
    const result = await sendEmail(env, "login", loginEmail({ to: issued.user.email, link, minutes: 15 }));
    if (result !== "sent") {
      await log("system", "auth.link_not_sent", { email, result });
      redirect(`/login?error=${encodeURIComponent("The sign-in email could not be sent. Ask an admin to check the email settings.")}`);
    }
    await log("system", "auth.link_sent", { email });
  } else {
    await log("system", "auth.link_refused", { email });
  }
  redirect(`/login?sent=${encodeURIComponent(email)}`);
}

export async function signOut() {
  const jar = await cookies();
  const { env } = await getCtx();
  await revokeSession(env, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

// ---- team management (admins) ------------------------------------------------

export async function addUser(formData: FormData) {
  const admin = await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const name = String(formData.get("name") ?? "").trim() || null;
  const role = (String(formData.get("role") ?? "member") === "admin" ? "admin" : "member") as UserRole;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/team?error=${encodeURIComponent("Enter a valid email address.")}`);
  const db = await getDb();
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) {
    await db.update(schema.users).set({ disabledAt: null, role, name: name ?? existing.name }).where(eq(schema.users.id, existing.id));
  } else {
    await db.insert(schema.users).values({ id: newId(), email, name, role, invitedBy: admin.email });
  }
  await log(admin.email, "team.user_added", { email, role });
  revalidatePath("/team");
  redirect(`/team?notice=${encodeURIComponent(`${email} can now sign in as ${role}.`)}`);
}

export async function setUserRole(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("userId"));
  const role = (String(formData.get("role")) === "admin" ? "admin" : "member") as UserRole;
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) redirect("/team");
  const { env } = await getCtx();
  if (role === "member" && adminEmails(env).includes(user.email)) redirect(`/team?error=${encodeURIComponent(`${user.email} is a configured admin (ADMIN_EMAILS) and stays an admin.`)}`);
  if (role === "member" && user.id === admin.userId) redirect(`/team?error=${encodeURIComponent("You can't remove your own admin role.")}`);
  await db.update(schema.users).set({ role }).where(eq(schema.users.id, id));
  await log(admin.email, "team.role_changed", { email: user.email, role });
  revalidatePath("/team");
  redirect("/team");
}

export async function removeUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("userId"));
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) redirect("/team");
  const { env } = await getCtx();
  if (adminEmails(env).includes(user.email)) redirect(`/team?error=${encodeURIComponent(`${user.email} is a configured admin (ADMIN_EMAILS) and can't be removed here.`)}`);
  if (user.id === admin.userId) redirect(`/team?error=${encodeURIComponent("You can't remove yourself.")}`);
  await db.update(schema.users).set({ disabledAt: nowIso() }).where(eq(schema.users.id, id));
  await revokeUserSessions(env, id);
  await log(admin.email, "team.user_removed", { email: user.email });
  revalidatePath("/team");
  redirect(`/team?notice=${encodeURIComponent(`${user.email} can no longer sign in.`)}`);
}

export async function signOutEverywhere() {
  const email = await currentActor();
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (user) {
    const jar = await cookies();
    const { env } = await getCtx();
    // Keep this browser's session; drop the rest.
    const mine = jar.get(SESSION_COOKIE)?.value;
    const { sha256Hex } = await import("@/lib/id");
    const keep = mine ? await sha256Hex(mine) : "";
    await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.tokenHash, keep)));
    await log(email, "auth.sessions_revoked", {});
    void env;
  }
  redirect(`/team?notice=${encodeURIComponent("Signed out of your other devices.")}`);
}
