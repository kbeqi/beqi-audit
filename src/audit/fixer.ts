// Applies one approved fix proposal through the fix agent and records the
// outcome. Runs inside the Workflow (production) or inline (local dev).

import { eq } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import { newId, nowIso } from "@/lib/id";
import { ensureFreshConnection } from "@/lib/webflow/mcp-oauth";
import { createEventSink } from "@/agent/events";
import { runFixAgent } from "@/agent/fix";
import { putJson, runKey } from "./store";
import type { RunEnv } from "./runner";

export async function applyProposal(env: RunEnv, proposalId: string): Promise<void> {
  const db = dbFromEnv(env);
  const proposal = await db.query.fixProposals.findFirst({ where: eq(schema.fixProposals.id, proposalId) });
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  if (proposal.status !== "approved" && proposal.status !== "applying") {
    throw new Error(`proposal ${proposalId} is ${proposal.status}, not approved`);
  }
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, proposal.siteId) });
  if (!site) throw new Error("site not found");
  const connection = site.connectionId
    ? await db.query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, site.connectionId) })
    : null;
  if (!connection || connection.revokedAt) throw new Error("Site has no active Webflow connection");
  const finding = proposal.findingId ? ((await db.query.findings.findFirst({ where: eq(schema.findings.id, proposal.findingId) })) ?? null) : null;

  await db.update(schema.fixProposals).set({ status: "applying", error: null }).where(eq(schema.fixProposals.id, proposal.id));
  const emit = createEventSink(env, proposal.id);
  try {
    const fresh = await ensureFreshConnection(env, connection);
    const out = await runFixAgent({ env, site, connection: fresh, proposal, finding, emit });
    await putJson(env.AUDIT_STORE, runKey(`fix-${proposal.id}`, "transcript"), out.messages);
    const applied = out.result.status === "applied";
    await db
      .update(schema.fixProposals)
      .set({
        status: applied ? "applied" : out.result.status === "skipped" ? "approved" : "failed",
        appliedAt: applied ? nowIso() : null,
        result: out.result,
        error: out.result.status === "failed" ? out.result.summary : null,
      })
      .where(eq(schema.fixProposals.id, proposal.id));
    if (applied && proposal.findingId) {
      // The finding stays open until the next audit confirms it is gone, but we
      // note the applied fix on its lifecycle row.
      await db
        .update(schema.findingStates)
        .set({ note: `Fix applied ${nowIso()}: ${out.result.summary}`.slice(0, 500), updatedAt: nowIso() })
        .where(eq(schema.findingStates.fingerprint, proposal.fingerprint));
    }
    await db.insert(schema.auditLog).values({
      id: newId(),
      siteId: site.id,
      actor: proposal.appliedBy ?? proposal.approvedBy ?? "agent",
      action: applied ? "fix.applied" : `fix.${out.result.status}`,
      detail: { proposalId: proposal.id, action: proposal.action, writes: out.writes, changes: out.result.changesMade, needsPublish: out.result.needsPublish, costUsd: out.usage.estimatedCostUsd },
    });
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await db.update(schema.fixProposals).set({ status: "failed", error: message.slice(0, 500) }).where(eq(schema.fixProposals.id, proposal.id));
    await emit("error", message.slice(0, 300));
    await db.insert(schema.auditLog).values({ id: newId(), siteId: site.id, actor: "agent", action: "fix.failed", detail: { proposalId: proposal.id, error: message.slice(0, 500) } });
    throw e;
  }
}
