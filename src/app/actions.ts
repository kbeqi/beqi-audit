"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import type { AuditFrequency } from "@/db/schema";
import { currentActor } from "@/lib/auth";
import { getCtx } from "@/lib/env";
import { newId, slugify } from "@/lib/id";
import { nextRunAfter, startRun } from "@/audit/start";

export async function createClient(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const db = await getDb();
  const id = newId();
  await db.insert(schema.clients).values({ id, name, slug: `${slugify(name)}-${id.slice(-4)}`, notes: String(formData.get("notes") ?? "") || null });
  await db.insert(schema.auditLog).values({ id: newId(), actor: await currentActor(), action: "client.created", detail: { clientId: id, name } });
  redirect(`/clients/${id}`);
}

export async function updateSiteSettings(formData: FormData) {
  const siteId = String(formData.get("siteId"));
  const freq = String(formData.get("auditFrequency")) as AuditFrequency;
  const keyPages = String(formData.get("keyPages") ?? "/")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("/") ? p : `/${p}`));
  const maxPages = Math.min(1000, Math.max(10, Number(formData.get("maxPages") ?? 200) || 200));
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
  await db.insert(schema.auditLog).values({ id: newId(), siteId, actor: await currentActor(), action: "site.settings_updated", detail: { freq, keyPages, maxPages } });
  revalidatePath(`/sites/${siteId}`);
}

export async function runNow(formData: FormData) {
  const siteId = String(formData.get("siteId"));
  const { env, ctx } = await getCtx();
  const db = await getDb();
  const { runId, mode } = await startRun(env, siteId, "manual", (p) => ctx.waitUntil(p));
  await db.insert(schema.auditLog).values({ id: newId(), siteId, actor: await currentActor(), action: "run.started", detail: { runId, mode } });
  redirect(`/runs/${runId}`);
}

export async function ignoreFinding(formData: FormData) {
  const siteId = String(formData.get("siteId"));
  const checkId = String(formData.get("checkId"));
  const pagePath = formData.get("pagePath") ? String(formData.get("pagePath")) : null;
  const scope = String(formData.get("scope") ?? "page");
  const back = String(formData.get("back") ?? `/sites/${siteId}`);
  const db = await getDb();
  const actor = await currentActor();
  await db.insert(schema.ignoreRules).values({ id: newId(), siteId, checkId, pagePath: scope === "site" ? null : pagePath, reason: String(formData.get("reason") ?? "") || null, createdBy: actor });
  await db.insert(schema.auditLog).values({ id: newId(), siteId, actor, action: "ignore_rule.created", detail: { checkId, pagePath, scope } });
  revalidatePath(back);
  redirect(back);
}

export async function markFindingState(formData: FormData) {
  const siteId = String(formData.get("siteId"));
  const fingerprint = String(formData.get("fingerprint"));
  const status = String(formData.get("status")) as "open" | "false_positive" | "ignored";
  const back = String(formData.get("back") ?? `/sites/${siteId}`);
  const db = await getDb();
  await db
    .update(schema.findingStates)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.findingStates.siteId, siteId), eq(schema.findingStates.fingerprint, fingerprint)));
  await db.insert(schema.auditLog).values({ id: newId(), siteId, actor: await currentActor(), action: "finding.state_changed", detail: { fingerprint, status } });
  revalidatePath(back);
  redirect(back);
}

export async function deleteIgnoreRule(formData: FormData) {
  const id = String(formData.get("id"));
  const siteId = String(formData.get("siteId"));
  const db = await getDb();
  await db.delete(schema.ignoreRules).where(eq(schema.ignoreRules.id, id));
  revalidatePath(`/sites/${siteId}`);
}
