"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import type { AuditFrequency } from "@/db/schema";
import { currentActor } from "@/lib/auth";
import { getCtx } from "@/lib/env";
import { newId, nowIso, slugify } from "@/lib/id";
import { importSitesForConnection } from "@/lib/webflow/import";
import { ensureFreshConnection } from "@/lib/webflow/mcp-oauth";
import { nextRunAfter, startFix, startRun } from "@/audit/start";

async function log(action: string, detail: Record<string, unknown>, siteId?: string | null) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ id: newId(), siteId: siteId ?? null, actor: await currentActor(), action, detail });
}

export async function createClient(formData: FormData) {
  await currentActor();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const db = await getDb();
  const id = newId();
  await db.insert(schema.clients).values({ id, name, slug: `${slugify(name)}-${id.slice(-4)}`, notes: String(formData.get("notes") ?? "") || null });
  await log("client.created", { clientId: id, name });
  redirect(`/clients/${id}`);
}

export async function updateClient(formData: FormData) {
  await currentActor();
  const id = String(formData.get("clientId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const db = await getDb();
  await db.update(schema.clients).set({ name, notes: String(formData.get("notes") ?? "") || null }).where(eq(schema.clients.id, id));
  await log("client.updated", { clientId: id, name });
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}`);
}

export async function updateSiteSettings(formData: FormData) {
  await currentActor();
  const siteId = String(formData.get("siteId"));
  const freq = String(formData.get("auditFrequency")) as AuditFrequency;
  const keyPages = String(formData.get("keyPages") ?? "/")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("/") ? p : `/${p}`));
  const maxPages = Math.min(200, Math.max(5, Number(formData.get("maxPages") ?? 40) || 40));
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  const db = await getDb();
  await db
    .update(schema.sites)
    .set({
      auditFrequency: freq,
      nextRunAt: nextRunAfter(freq),
      keyPages: keyPages.length ? keyPages : ["/"],
      maxPages,
      isEnterprise: formData.get("isEnterprise") === "on",
      ...(baseUrl ? { baseUrl } : {}),
    })
    .where(eq(schema.sites.id, siteId));
  await log("site.settings_updated", { freq, keyPages, maxPages }, siteId);
  revalidatePath(`/sites/${siteId}`);
  redirect(`/sites/${siteId}`);
}

export async function runNow(formData: FormData) {
  await currentActor();
  const siteId = String(formData.get("siteId"));
  const { env, ctx } = await getCtx();
  const { runId, mode } = await startRun(env, siteId, "manual", (p) => ctx.waitUntil(p));
  await log("run.started", { runId, mode }, siteId);
  redirect(`/runs/${runId}`);
}

export async function ignoreFinding(formData: FormData) {
  await currentActor();
  const siteId = String(formData.get("siteId"));
  const checkId = String(formData.get("checkId"));
  const pagePath = formData.get("pagePath") ? String(formData.get("pagePath")) : null;
  const scope = String(formData.get("scope") ?? "page");
  const back = String(formData.get("back") ?? `/sites/${siteId}`);
  const db = await getDb();
  await db.insert(schema.ignoreRules).values({ id: newId(), siteId, checkId, pagePath: scope === "site" ? null : pagePath, reason: String(formData.get("reason") ?? "") || null, createdBy: await currentActor() });
  await log("ignore_rule.created", { checkId, pagePath, scope }, siteId);
  revalidatePath(back);
  redirect(back);
}

export async function markFindingState(formData: FormData) {
  await currentActor();
  const siteId = String(formData.get("siteId"));
  const fingerprint = String(formData.get("fingerprint"));
  const status = String(formData.get("status")) as "open" | "false_positive" | "ignored";
  const back = String(formData.get("back") ?? `/sites/${siteId}`);
  const db = await getDb();
  await db
    .update(schema.findingStates)
    .set({ status, updatedAt: nowIso() })
    .where(and(eq(schema.findingStates.siteId, siteId), eq(schema.findingStates.fingerprint, fingerprint)));
  await log("finding.state_changed", { fingerprint, status }, siteId);
  revalidatePath(back);
  redirect(back);
}

export async function deleteIgnoreRule(formData: FormData) {
  await currentActor();
  const id = String(formData.get("id"));
  const siteId = String(formData.get("siteId"));
  const db = await getDb();
  await db.delete(schema.ignoreRules).where(eq(schema.ignoreRules.id, id));
  revalidatePath(`/sites/${siteId}`);
}

// Fix proposals: approve, reject, or approve-and-apply. Only "approved" rows
// are ever handed to the fix agent.
export async function decideProposal(formData: FormData) {
  const actor = await currentActor();
  const id = String(formData.get("proposalId"));
  const decision = String(formData.get("decision")) as "approve" | "reject" | "apply";
  const back = String(formData.get("back") ?? "/");
  const db = await getDb();
  const proposal = await db.query.fixProposals.findFirst({ where: eq(schema.fixProposals.id, id) });
  if (!proposal) throw new Error("Proposal not found");

  if (decision === "reject") {
    await db.update(schema.fixProposals).set({ status: "rejected", approvedBy: actor }).where(eq(schema.fixProposals.id, id));
    await log("fix.rejected", { proposalId: id, action: proposal.action }, proposal.siteId);
  } else {
    if (!["proposed", "approved", "failed"].includes(proposal.status)) throw new Error(`Proposal is ${proposal.status}`);
    await db.update(schema.fixProposals).set({ status: "approved", approvedBy: actor, error: null }).where(eq(schema.fixProposals.id, id));
    await log("fix.approved", { proposalId: id, action: proposal.action }, proposal.siteId);
    if (decision === "apply") {
      await db.update(schema.fixProposals).set({ appliedBy: actor }).where(eq(schema.fixProposals.id, id));
      const { env, ctx } = await getCtx();
      const { mode } = await startFix(env, id, (p) => ctx.waitUntil(p));
      await log("fix.apply_started", { proposalId: id, mode }, proposal.siteId);
      revalidatePath(back);
      redirect(`/fixes/${id}`);
    }
  }
  revalidatePath(back);
  redirect(back);
}

// Re-reads the sites a connection can see (after a failed import, or when the
// workspace gained sites).
export async function reimportSites(formData: FormData) {
  const actor = await currentActor();
  const id = String(formData.get("connectionId"));
  const clientId = String(formData.get("clientId"));
  const db = await getDb();
  const { env } = await getCtx();
  const connection = await db.query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, id) });
  if (!connection || connection.revokedAt) throw new Error("Connection not found");
  try {
    const fresh = await ensureFreshConnection(env, connection);
    const { imported } = await importSitesForConnection(db, fresh, env);
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "webflow.sites_imported", detail: { clientId, connectionId: id, sites: imported } });
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?connected=${imported}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const message = (e as Error).message ?? String(e);
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "webflow.import_failed", detail: { clientId, connectionId: id, error: message.slice(0, 500) } });
    redirect(`/clients/${clientId}?error=${encodeURIComponent(message.slice(0, 200))}`);
  }
}

export async function disconnectWorkspace(formData: FormData) {
  await currentActor();
  const id = String(formData.get("connectionId"));
  const clientId = String(formData.get("clientId"));
  const db = await getDb();
  await db.update(schema.webflowConnections).set({ revokedAt: nowIso() }).where(eq(schema.webflowConnections.id, id));
  await db.update(schema.sites).set({ connectionId: null }).where(eq(schema.sites.connectionId, id));
  await log("webflow.disconnected", { connectionId: id, clientId });
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}
