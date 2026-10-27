import { and, eq, isNotNull, lte, ne, or, isNull } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import { nextRunAfter, startRun } from "./start";

// Cron tick (hourly). Starts a run for every site whose schedule is due and
// moves next_run_at forward before starting so a slow run can't double-fire.
export async function runScheduler(env: CloudflareEnv, now: Date): Promise<{ started: string[] }> {
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
  return { started };
}
