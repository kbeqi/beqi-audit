import { and, eq, gt, isNotNull, lte, ne, or, isNull } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import { parseRecipients, reminderEmail, sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { nextRunAfter, startRun } from "./start";

const REMINDER_WINDOW_MS = 26 * 60 * 60 * 1000;

// Cron tick (hourly). Starts a run for every site whose schedule is due and
// moves next_run_at forward before starting so a slow run can't double-fire.
// Then sends one reminder per upcoming scheduled audit (about a day ahead).
export async function runScheduler(env: CloudflareEnv, now: Date): Promise<{ started: string[]; reminders: number }> {
  const db = dbFromEnv(env);
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
  return { started, reminders };
}
