import { and, eq, gt, isNotNull, lte, ne, or, isNull } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import { newId } from "@/lib/id";
import { monthlyEmail, parseRecipients, reminderEmail, sendEmail } from "@/lib/email";
import { clientProgress, previousMonth } from "@/lib/progress";
import { monthlySlack, postSlack, slackConfigured } from "@/lib/slack";
import { appUrl } from "@/lib/env";
import { ensureFreshConnection } from "@/lib/webflow/mcp-oauth";
import { nextRunAfter, startRun } from "./start";

const REMINDER_WINDOW_MS = 26 * 60 * 60 * 1000;

// Cron tick (every 20 minutes). Keeps Webflow tokens alive, starts a run for
// every site whose schedule is due (next_run_at moves forward before starting
// so a slow run can't double-fire), then sends one reminder per upcoming
// scheduled audit (about a day ahead). Every part is idempotent, so a more
// frequent tick is safe.
export async function runScheduler(env: CloudflareEnv, now: Date): Promise<{ started: string[]; reminders: number; refreshed: number; monthly: number }> {
  const db = dbFromEnv(env);
  const refreshed = await keepConnectionsAlive(env, now);
  const due = await db.query.sites.findMany({
    where: and(
      ne(schema.sites.auditFrequency, "off"),
      isNotNull(schema.sites.connectionId),
      or(isNull(schema.sites.nextRunAt), lte(schema.sites.nextRunAt, now.toISOString())),
    ),
  });
  const started: string[] = [];
  for (const site of due) {
    await db.update(schema.sites).set({ nextRunAt: nextRunAfter(site.auditFrequency, now) }).where(eq(schema.sites.id, site.id));
    try {
      const { runId } = await startRun(env, site.id, "schedule");
      started.push(runId);
    } catch (e) {
      console.error(`scheduler: failed to start run for site ${site.id}`, e);
    }
  }

  let reminders = 0;
  const horizon = new Date(now.getTime() + REMINDER_WINDOW_MS).toISOString();
  const upcoming = await db.query.sites.findMany({
    where: and(
      ne(schema.sites.auditFrequency, "off"),
      isNotNull(schema.sites.connectionId),
      isNotNull(schema.sites.nextRunAt),
      gt(schema.sites.nextRunAt, now.toISOString()),
      lte(schema.sites.nextRunAt, horizon),
    ),
  });
  for (const site of upcoming) {
    if (!site.nextRunAt || site.reminderSentFor === site.nextRunAt) continue;
    const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId) });
    const to = client?.notifyReminder ? parseRecipients(client.notifyEmail) : [];
    // Mark first so a failing provider can't cause a reminder storm.
    await db.update(schema.sites).set({ reminderSentFor: site.nextRunAt }).where(eq(schema.sites.id, site.id));
    if (!client || to.length === 0) continue;
    const result = await sendEmail(
      env,
      "reminder",
      reminderEmail({ to, clientName: client.name, siteName: site.name, siteHost: new URL(site.baseUrl).host, when: new Date(site.nextRunAt), appUrl: appUrl(env), siteId: site.id }),
      site.id,
    );
    if (result === "sent") reminders++;
  }
  const monthly = await sendMonthlyReports(env, now);
  return { started, reminders, refreshed, monthly };
}

// On the first of each month (UTC), one progress report per client who has
// somewhere to receive it: last month's scores then and now, fixes applied,
// issues resolved, what is waiting. `monthly_report_sent_for` is set before
// sending so a failing provider can't repeat it on the next tick.
export async function sendMonthlyReports(env: CloudflareEnv, now: Date, force = false, onlyClientId?: string): Promise<number> {
  if (!force && now.getUTCDate() !== 1) return 0;
  const db = dbFromEnv(env);
  const { since, until, key, label } = previousMonth(now);
  const clients = await db.query.clients.findMany({ where: onlyClientId ? eq(schema.clients.id, onlyClientId) : eq(schema.clients.notifyMonthly, true) });
  let sent = 0;
  for (const client of clients) {
    if (client.monthlyReportSentFor === key) continue;
    const to = parseRecipients(client.notifyEmail);
    const slack = slackConfigured(client.slackWebhookUrl) ? client.slackWebhookUrl : null;
    await db.update(schema.clients).set({ monthlyReportSentFor: key }).where(eq(schema.clients.id, client.id));
    if (to.length === 0 && !slack) continue;
    const progress = await clientProgress(db, client.id, since, until);
    // Nothing audited yet: no report, nothing to say.
    if (progress.sites.every((s) => s.score == null)) continue;
    const link = `${appUrl(env)}/clients/${client.id}`;
    if (to.length) {
      const r = await sendEmail(
        env,
        "monthly",
        monthlyEmail({
          to,
          clientName: client.name,
          month: label,
          sites: progress.sites.map((s) => ({ name: s.name, score: s.score, scoreBefore: s.scoreBefore, openFindings: s.openFindings, openBefore: s.openBefore, vitals: s.vitalsPassing, ai: s.aiMentioned ? { now: s.aiMentioned.now, of: s.aiMentioned.of, before: s.aiMentioned.before } : null })),
          fixesApplied: progress.fixesAppliedTitles,
          resolved: progress.resolved,
          waiting: progress.waiting,
          audits: progress.audits,
          leadName: client.leadName,
          leadEmail: client.leadEmail,
          appUrl: appUrl(env),
          clientId: client.id,
        }),
      );
      if (r === "sent") sent++;
    }
    if (slack) {
      const ai = progress.sites.find((s) => s.aiMentioned)?.aiMentioned ?? null;
      await postSlack(env, slack, "monthly", monthlySlack({ clientName: client.name, month: label, sites: progress.sites.map((s) => ({ name: s.name, score: s.score, scoreBefore: s.scoreBefore })), fixesApplied: progress.fixesApplied, resolved: progress.resolved, waiting: progress.waiting, aiMentioned: ai ? { now: ai.now, of: ai.of } : null, link }));
    }
  }
  return sent;
}

// Webflow's MCP refresh tokens only work while the access token is still
// valid: once a token has expired, the grant is gone and the workspace must
// be connected again by a person. Tokens last an hour, so every tick refreshes
// any active connection with under 45 minutes left (ensureFreshConnection's
// threshold), keeping idle connections alive between audits.
async function keepConnectionsAlive(env: CloudflareEnv, now: Date): Promise<number> {
  const db = dbFromEnv(env);
  const connections = await db.query.webflowConnections.findMany({ where: and(isNull(schema.webflowConnections.revokedAt), eq(schema.webflowConnections.authKind, "mcp_oauth")) });
  let refreshed = 0;
  for (const c of connections) {
    if (!c.expiresAt || !c.refreshToken) continue;
    if (new Date(c.expiresAt).getTime() <= now.getTime()) continue; // already lost; needs a reconnect
    try {
      const fresh = await ensureFreshConnection(env, c);
      if (fresh.expiresAt !== c.expiresAt) refreshed++;
    } catch (e) {
      // Mark the token expired right away so the client pages say "reconnect"
      // instead of waiting for the nominal expiry to pass.
      await db.update(schema.webflowConnections).set({ expiresAt: now.toISOString() }).where(eq(schema.webflowConnections.id, c.id));
      await db.insert(schema.auditLog).values({
        id: newId(),
        actor: "system",
        action: "webflow.refresh_failed",
        detail: { connectionId: c.id, clientId: c.clientId, error: String((e as Error).message ?? e).slice(0, 300) },
      });
    }
  }
  return refreshed;
}
