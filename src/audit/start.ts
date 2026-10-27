import { eq } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import type { AuditFrequency, RunTrigger } from "@/db/schema";
import { newId, nowIso } from "@/lib/id";
import { runAuditInline } from "./runner";

export interface AuditWorkflowParams {
  runId: string;
}

// Creates the run row and hands it to the Workflow. Falls back to running the
// pipeline inline when no Workflow binding is available (local `next dev`).
export async function startRun(
  env: CloudflareEnv,
  siteId: string,
  trigger: RunTrigger,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<{ runId: string; mode: "workflow" | "inline" }> {
  const db = dbFromEnv(env);
  const runId = newId();
  await db.insert(schema.runs).values({ id: runId, siteId, trigger, status: "queued" });

  const workflow = env.AUDIT_RUN as Workflow<AuditWorkflowParams> | undefined;
  if (workflow && typeof workflow.create === "function") {
    try {
      const instance = await workflow.create({ id: runId, params: { runId } });
      await db.update(schema.runs).set({ workflowInstanceId: instance.id }).where(eq(schema.runs.id, runId));
      return { runId, mode: "workflow" };
    } catch (e) {
      console.warn("workflow.create failed, running inline:", (e as Error).message);
    }
  }
  const p = runAuditInline(env, runId).catch((e) => console.error("inline audit failed", e));
  if (waitUntil) waitUntil(p);
  else await p;
  return { runId, mode: "inline" };
}

export function nextRunAfter(freq: AuditFrequency, from = new Date()): string | null {
  const d = new Date(from);
  switch (freq) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "off":
      return null;
  }
  // Run at 03:00 UTC so client-facing hours stay clean.
  d.setUTCHours(3, 0, 0, 0);
  return d.toISOString();
}

export { nowIso };
