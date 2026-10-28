import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { addUser, removeUser, setUserRole, signOutEverywhere } from "@/app/auth-actions";
import { adminEmails, currentActorOrNull } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardHeader, EmptyState, Notice, PageHeader, btnDanger, btnPrimary, btnSecondary, btnSm, fmtDate, inputCls, labelCls, timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const actor = await currentActorOrNull();
  if (!actor) redirect("/login?next=/team");
  const env = await getEnv();
  const db = await getDb();
  const users = await db.query.users.findMany({ orderBy: desc(schema.users.createdAt) });
  const configured = adminEmails(env);
  const active = users.filter((u) => !u.disabledAt);
  const removed = users.filter((u) => u.disabledAt);
  const isAdmin = actor.role === "admin";
  const mailReady = emailConfigured(env);

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Who can sign in to Beqi Audit. Members see and do everything except manage the team." />
      {notice && <Notice tone="good">{decodeURIComponent(notice)}</Notice>}
      {error && <Notice tone="critical">{decodeURIComponent(error)}</Notice>}
      {!mailReady && <Notice tone="warn">Sign-in links are sent by email and email isn&apos;t configured (RESEND_API_KEY / EMAIL_FROM). Nobody new can sign in until it is.</Notice>}
      {(env.AUTH_MODE ?? "app") === "open" && <Notice tone="warn">AUTH_MODE is &quot;open&quot;: the team list is not enforced until it is set to &quot;app&quot; in wrangler.jsonc.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="People" count={active.length} />
          {active.length === 0 ? (
            <EmptyState title="No one yet" body="Configured admins can always sign in; add everyone else here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Last sign-in</th>
                    <th>Added</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {active.map((u) => {
                    const locked = configured.includes(u.email);
                    const me = u.email === actor.email;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="font-medium text-ink">
                            {u.name ?? u.email}
                            {me && <span className="ml-1.5 text-xs text-ink-3">(you)</span>}
                          </div>
                          {u.name && <div className="text-xs text-ink-3">{u.email}</div>}
                        </td>
                        <td>
                          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${u.role === "admin" ? "tone-accent" : "tone-neutral"}`}>{u.role}</span>
                          {locked && <span className="ml-1.5 text-xs text-ink-3" title="Listed in ADMIN_EMAILS; always an admin">configured</span>}
                        </td>
                        <td className="text-ink-2">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}</td>
                        <td className="text-ink-2">
                          {fmtDate(u.createdAt)}
                          {u.invitedBy && u.invitedBy !== "config" && <div className="text-xs text-ink-3">by {u.invitedBy}</div>}
                        </td>
                        {isAdmin && (
                          <td className="text-right">
                            {!locked && !me && (
                              <div className="flex justify-end gap-1.5">
                                <form action={setUserRole}>
                                  <input type="hidden" name="userId" value={u.id} />
                                  <input type="hidden" name="role" value={u.role === "admin" ? "member" : "admin"} />
                                  <SubmitButton className={`${btnSecondary} ${btnSm}`} pendingLabel="Saving…">
                                    {u.role === "admin" ? "Make member" : "Make admin"}
                                  </SubmitButton>
                                </form>
                                <form action={removeUser}>
                                  <input type="hidden" name="userId" value={u.id} />
                                  <SubmitButton className={`${btnDanger} ${btnSm}`} confirm={`Remove ${u.email}? They are signed out everywhere and can no longer sign in.`} pendingLabel="Removing…">
                                    Remove
                                  </SubmitButton>
                                </form>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {removed.length > 0 && (
            <details className="border-t border-line">
              <summary className="px-5 py-2.5 text-xs font-medium text-ink-3 hover:text-ink">Removed ({removed.length})</summary>
              <ul className="divide-y divide-line border-t border-line text-sm">
                {removed.map((u) => (
                  <li key={u.id} className="flex items-center justify-between px-5 py-2 text-ink-2">
                    <span>{u.email}</span>
                    <span className="text-xs text-ink-3">removed {timeAgo(u.disabledAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <div className="space-y-6">
          {isAdmin ? (
            <Card>
              <CardHeader title="Add a person" description="They sign in with a one-time link sent to this address." />
              <form action={addUser} className="space-y-3 p-5">
                <div>
                  <label htmlFor="email" className={labelCls}>
                    Email
                  </label>
                  <input id="email" name="email" type="email" required className={inputCls} placeholder="name@beqi.co" />
                </div>
                <div>
                  <label htmlFor="name" className={labelCls}>
                    Name (optional)
                  </label>
                  <input id="name" name="name" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="role" className={labelCls}>
                    Role
                  </label>
                  <select id="role" name="role" defaultValue="member" className={inputCls}>
                    <option value="member">Member — audits, fixes, clients</option>
                    <option value="admin">Admin — also manages the team</option>
                  </select>
                </div>
                <SubmitButton className={`${btnPrimary} w-full`} pendingLabel="Adding…">
                  Add to team
                </SubmitButton>
              </form>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Add a person" />
              <p className="p-5 text-sm text-ink-2">Only admins can add or remove people. Ask one of the admins above.</p>
            </Card>
          )}
          <Card>
            <CardHeader title="Your sessions" description="Sign-in links create a 30-day session per browser." />
            <form action={signOutEverywhere} className="p-5">
              <SubmitButton className={btnSecondary} pendingLabel="Signing out…">
                Sign out of other devices
              </SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
