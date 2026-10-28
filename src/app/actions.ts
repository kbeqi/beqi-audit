"use server";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import type { AuditFrequency } from "@/db/schema";
import { currentActor } from "@/lib/auth";
import { appUrl, getCtx } from "@/lib/env";
import { parseRecipients, sendEmail, testEmail } from "@/lib/email";
import { newId, nowIso, slugify } from "@/lib/id";
import { importSitesForConnection } from "@/lib/webflow/import";
import { ensureFreshConnection } from "@/lib/webflow/mcp-oauth";
import { nextRunAfter, startFix, startRun } from "@/audit/start";

async function log(action: string, detail: Record<string, unknown>, siteId?: string | null) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ id: newId(), siteId: siteId ?? null, actor: await currentActor(), action, detail });
}

// Every action runs through this so an unexpected error is recorded in
// audit_log (production builds hide the message from the browser), then
// rethrown for the error boundary. Redirects are not errors.
async function guarded<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const err = e as Error;
    try {
      const db = await getDb();
      await db.insert(schema.auditLog).values({
        id: newId(),
        actor: "system",
        action: "action.error",
        detail: { action: name, message: String(err?.message ?? e).slice(0, 500), stack: String(err?.stack ?? "").slice(0, 1500) },
      });
    } catch {
      /* the original error matters more */
    }
    throw e;
  }
}

export async function createClient(formData: FormData) {
  return guarded("createClient", async () => {
    await currentActor();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("Name is required");
    const db = await getDb();
    const id = newId();
    await db.insert(schema.clients).values({ id, name, slug: `${slugify(name)}-${id.slice(-4)}`, notes: String(formData.get("notes") ?? "") || null });
    await log("client.created", { clientId: id, name });
    redirect(`/clients/${id}`);
  });
}

export async function updateClient(formData: FormData) {
  return guarded("updateClient", async () => {
    await currentActor();
    const id = String(formData.get("clientId"));
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("Name is required");
    const rawEmail = String(formData.get("notifyEmail") ?? "").trim();
    const recipients = parseRecipients(rawEmail);
    if (rawEmail && recipients.length === 0) redirect(`/clients/${id}?error=${encodeURIComponent("That notification email address doesn't look valid.")}`);
    const db = await getDb();
    await db
      .update(schema.clients)
      .set({
        name,
        notes: String(formData.get("notes") ?? "") || null,
        notifyEmail: recipients.length ? recipients.join(", ") : null,
        notifyReminder: formData.get("notifyReminder") === "on",
        notifyResults: formData.get("notifyResults") === "on",
      })
      .where(eq(schema.clients.id, id));
    await log("client.updated", { clientId: id, name, notifyEmail: recipients });
    revalidatePath(`/clients/${id}`);
    redirect(`/clients/${id}?saved=1`);
  });
}

export async function sendTestEmail(formData: FormData) {
  return guarded("sendTestEmail", async () => {
    await currentActor();
    const id = String(formData.get("clientId"));
    const db = await getDb();
    const { env } = await getCtx();
    const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, id) });
    if (!client) throw new Error("Client not found");
    const to = parseRecipients(client.notifyEmail);
    if (to.length === 0) redirect(`/clients/${id}?error=${encodeURIComponent("Save a notification email first.")}`);
    const result = await sendEmail(env, "test", testEmail({ to, clientName: client.name, appUrl: appUrl(env) }));
    const msg =
      result === "sent"
        ? `Test email sent to ${to.join(", ")}.`
        : result === "skipped"
          ? "Email isn't configured yet: set the RESEND_API_KEY secret and EMAIL_FROM in wrangler.jsonc."
          : "The email provider rejected the message; details are in the activity log.";
    redirect(`/clients/${id}?${result === "sent" ? "notice" : "error"}=${encodeURIComponent(msg)}`);
  });
}

// Removes a client and everything under it. Site-scoped rows cascade through
// foreign keys; run_events and audit_log rows are cleaned up explicitly.
export async function deleteClient(formData: FormData) {
  return guarded("deleteClient", async () => {
    const actor = await currentActor();
    const id = String(formData.get("clientId"));
    const db = await getDb();
    const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, id) });
    if (!client) throw new Error("Client not found");
    const sites = await db.query.sites.findMany({ where: eq(schema.sites.clientId, id), columns: { id: true } });
    const siteIds = sites.map((s) => s.id);
    if (siteIds.length) {
      const runs = await db.query.runs.findMany({ where: inArray(schema.runs.siteId, siteIds), columns: { id: true } });
      const proposals = await db.query.fixProposals.findMany({ where: inArray(schema.fixProposals.siteId, siteIds), columns: { id: true } });
      const streams = [...runs.map((r) => r.id), ...proposals.map((p) => p.id)];
      for (let i = 0; i < streams.length; i += 50) {
        await db.delete(schema.runEvents).where(inArray(schema.runEvents.streamId, streams.slice(i, i + 50)));
      }
      for (let i = 0; i < siteIds.length; i += 50) {
        await db.delete(schema.auditLog).where(inArray(schema.auditLog.siteId, siteIds.slice(i, i + 50)));
      }
    }
    await db.delete(schema.clients).where(eq(schema.clients.id, id));
    await db.insert(schema.auditLog).values({ id: newId(), actor, action: "client.deleted", detail: { clientId: id, name: client.name, sites: siteIds.length } });
    revalidatePath("/");
    revalidatePath("/clients");
    redirect(`/clients?deleted=${encodeURIComponent(client.name)}`);
  });
}

export async function updateSiteSettings(formData: FormData) {
  return guarded("updateSiteSettings", async () => {
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
    redirect(`/sites/${siteId}?saved=1`);
  });
}

export async function runNow(formData: FormData) {
  return guarded("runNow", async () => {
    await currentActor();
    const siteId = String(formData.get("siteId"));
    const db = await getDb();
    // One audit at a time per site: a second click while one is live opens it.
    const live = await db.query.runs.findFirst({
      where: and(eq(schema.runs.siteId, siteId), inArray(schema.runs.status, ["queued", "running"])),
      columns: { id: true },
    });
    if (live) redirect(`/runs/${live.id}`);
    const { env, ctx } = await getCtx();
    const { runId, mode } = await startRun(env, siteId, "manual", (p) => ctx.waitUntil(p));
    await log("run.started", { runId, mode }, siteId);
    redirect(`/runs/${runId}`);
  });
}

export async function ignoreFinding(formData: FormData) {
  return guarded("ignoreFinding", async () => {
    const actor = await currentActor();
    const siteId = String(formData.get("siteId"));
    const checkId = String(formData.get("checkId"));
    const pagePath = formData.get("pagePath") ? String(formData.get("pagePath")) : null;
    const scope = String(formData.get("scope") ?? "page");
    const back = String(formData.get("back") ?? `/sites/${siteId}`);
    const db = await getDb();
    await db.insert(schema.ignoreRules).values({ id: newId(), siteId, checkId, pagePath: scope === "site" ? null : pagePath, reason: String(formData.get("reason") ?? "") || null, createdBy: actor });
    await log("ignore_rule.created", { checkId, pagePath, scope }, siteId);
    revalidatePath(back.split("#")[0]);
    redirect(back);
  });
}

export async function markFindingState(formData: FormData) {
  return guarded("markFindingState", async () => {
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
    revalidatePath(back.split("#")[0]);
    redirect(back);
  });
}

export async function deleteIgnoreRule(formData: FormData) {
  return guarded("deleteIgnoreRule", async () => {
    await currentActor();
    const id = String(formData.get("id"));
    const siteId = String(formData.get("siteId"));
    const db = await getDb();
    await db.delete(schema.ignoreRules).where(eq(schema.ignoreRules.id, id));
    revalidatePath(`/sites/${siteId}`);
    redirect(`/sites/${siteId}`);
  });
}

// Fix proposals: approve, reject, or approve-and-apply. The apply branch
// claims the row atomically (status -> applying) so two clicks, two tabs or
// a retried request can never apply the same fix twice.
export async function decideProposal(formData: FormData) {
  return guarded("decideProposal", async () => {
    const actor = await currentActor();
    const id = String(formData.get("proposalId"));
    const decision = String(formData.get("decision")) as "approve" | "reject" | "apply" | "resolved";
    const back = String(formData.get("back") ?? "/fixes");
    const db = await getDb();
    const proposal = await db.query.fixProposals.findFirst({ where: eq(schema.fixProposals.id, id) });
    if (!proposal) throw new Error("Proposal not found");
    const reviewable = ["proposed", "approved", "failed"] as const;

    if (decision === "resolved") {
      // A person made the change on the site. Close the proposal and the
      // finding; the next audit re-verifies and reopens it if still present.
      await db
        .update(schema.fixProposals)
        .set({
          status: "resolved",
          approvedBy: actor,
          appliedBy: actor,
          appliedAt: nowIso(),
          error: null,
          result: { status: "manual", summary: `Marked as fixed on the site by ${actor}.`, changesMade: [], verification: "Confirmed by a person; the next audit re-checks it.", needsPublish: false },
        })
        .where(and(eq(schema.fixProposals.id, id), inArray(schema.fixProposals.status, [...reviewable])));
      await db
        .update(schema.findingStates)
        .set({ status: "fixed", note: `Fixed manually by ${actor} on ${nowIso().slice(0, 10)}`, updatedAt: nowIso() })
        .where(and(eq(schema.findingStates.siteId, proposal.siteId), eq(schema.findingStates.fingerprint, proposal.fingerprint)));
      await log("fix.resolved_manually", { proposalId: id, action: proposal.action }, proposal.siteId);
    } else if (decision === "reject") {
      await db
        .update(schema.fixProposals)
        .set({ status: "rejected", approvedBy: actor })
        .where(and(eq(schema.fixProposals.id, id), inArray(schema.fixProposals.status, [...reviewable])));
      await log("fix.rejected", { proposalId: id, action: proposal.action }, proposal.siteId);
    } else if (decision === "approve") {
      await db
        .update(schema.fixProposals)
        .set({ status: "approved", approvedBy: actor, error: null })
        .where(and(eq(schema.fixProposals.id, id), inArray(schema.fixProposals.status, [...reviewable])));
      await log("fix.approved", { proposalId: id, action: proposal.action }, proposal.siteId);
    } else {
      const claimed = await db
        .update(schema.fixProposals)
        .set({ status: "applying", approvedBy: actor, appliedBy: actor, error: null, result: null })
        .where(and(eq(schema.fixProposals.id, id), inArray(schema.fixProposals.status, [...reviewable])))
        .returning({ id: schema.fixProposals.id });
      if (claimed.length === 0) redirect(`/fixes/${id}`); // already applying or applied
      await log("fix.approved", { proposalId: id, action: proposal.action }, proposal.siteId);
      const { env, ctx } = await getCtx();
      const { mode } = await startFix(env, id, (p) => ctx.waitUntil(p));
      await log("fix.apply_started", { proposalId: id, mode }, proposal.siteId);
      redirect(`/fixes/${id}`);
    }
    revalidatePath(back.split("#")[0]);
    redirect(back);
  });
}

// Re-reads the sites a connection can see (after a failed import, or when the
// workspace gained sites).
export async function reimportSites(formData: FormData) {
  return guarded("reimportSites", async () => {
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
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      await db.insert(schema.auditLog).values({ id: newId(), actor, action: "webflow.import_failed", detail: { clientId, connectionId: id, error: message.slice(0, 500) } });
      redirect(`/clients/${clientId}?error=${encodeURIComponent(message.slice(0, 200))}`);
    }
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}?imported=1`);
  });
}

// Public report links. A token is created once per run and reused; stopping
// sharing clears it, which makes the old link stop working.
export async function shareRun(formData: FormData) {
  return guarded("shareRun", async () => {
    const actor = await currentActor();
    const runId = String(formData.get("runId"));
    const db = await getDb();
    const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
    if (!run) throw new Error("Run not found");
    if (run.status !== "complete") redirect(`/runs/${runId}?error=${encodeURIComponent("Only completed audits can be shared.")}`);
    if (!run.shareToken) {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      const token = [...bytes].map((b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
      await db.update(schema.runs).set({ shareToken: token, sharedAt: nowIso(), sharedBy: actor }).where(eq(schema.runs.id, runId));
      await log("run.shared", { runId }, run.siteId);
    }
    revalidatePath(`/runs/${runId}`);
    redirect(`/runs/${runId}?shared=1`);
  });
}

export async function unshareRun(formData: FormData) {
  return guarded("unshareRun", async () => {
    await currentActor();
    const runId = String(formData.get("runId"));
    const db = await getDb();
    const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId), columns: { siteId: true } });
    await db.update(schema.runs).set({ shareToken: null, sharedAt: null, sharedBy: null }).where(eq(schema.runs.id, runId));
    await log("run.unshared", { runId }, run?.siteId);
    revalidatePath(`/runs/${runId}`);
    redirect(`/runs/${runId}?unshared=1`);
  });
}

export async function disconnectWorkspace(formData: FormData) {
  return guarded("disconnectWorkspace", async () => {
    await currentActor();
    const id = String(formData.get("connectionId"));
    const clientId = String(formData.get("clientId"));
    const db = await getDb();
    await db.update(schema.webflowConnections).set({ revokedAt: nowIso() }).where(eq(schema.webflowConnections.id, id));
    await db.update(schema.sites).set({ connectionId: null }).where(eq(schema.sites.connectionId, id));
    await log("webflow.disconnected", { connectionId: id, clientId });
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}`);
  });
}
