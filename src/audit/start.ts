import { eq } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import type { AuditFrequency, RunTrigger } from "@/db/schema";
import { newId, nowIso } from "@/lib/id";
import { runAuditInline } from "./runner";
import { applyProposal } from "./fixer";

export type AuditWorkflowParams = { kind: "audit"; runId: string } | { kind: "fix"; proposalId: string };

type WorkflowBinding = { create(opts: { id: string; params: AuditWorkflowParams }): Promise<{ id: string }> };

function workflowBinding(env: CloudflareEnv): WorkflowBinding | null {
  const wf = env.AUDIT_RUN as unknown as WorkflowBinding | undefined;
  return wf && typeof wf.create === "function" ? wf : null;
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

  const workflow = workflowBinding(env);
  if (workflow) {
    try {
      const instance = await workflow.create({ id: runId, params: { kind: "audit", runId } });
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

// Applies an approved proposal via the Workflow (or inline locally).
export async function startFix(env: CloudflareEnv, proposalId: string, waitUntil?: (p: Promise<unknown>) => void): Promise<{ mode: "workflow" | "inline" }> {
  const workflow = workflowBinding(env);
  if (workflow) {
    try {
      // Instance ids are unique per Workflow; a retry of the same proposal gets
      // a fresh id while the status guard in decideProposal prevents doubles.
      await workflow.create({ id: `fix-${proposalId}-${Date.now().toString(36)}`, params: { kind: "fix", proposalId } });
      return { mode: "workflow" };
    } catch (e) {
      console.warn("workflow.create failed, applying inline:", (e as Error).message);
    }
  }
  const p = applyProposal(env, proposalId).catch((e) => console.error("inline fix failed", e));
  if (waitUntil) waitUntil(p);
  else await p;
  return { mode: "inline" };
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
