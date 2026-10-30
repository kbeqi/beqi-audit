// The audit pipeline as independent steps. The Workflow (production) and the
// inline runner (local dev / fallback) both call these in order; each step
// re-reads what it needs from D1 and KV so it can be retried on its own.

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import type { CategoryKey, RunSummary, Severity } from "@/db/schema";
import { parseRecipients, resultsEmail, sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { newId, nowIso, sha256Hex } from "@/lib/id";
import { ensureFreshConnection } from "@/lib/webflow/mcp-oauth";
import { runAuditAgent, structureAuditReport } from "@/agent/audit";
import { sampleAiVisibility } from "@/agent/ai-visibility";
import { CHECKS, isCheckId } from "@/agent/catalog";
import { createEventSink } from "@/agent/events";
import { MODEL, emptyUsage } from "@/agent/anthropic";
import type { PreviousFinding } from "@/agent/prompts";
import type { AuditReport } from "@/agent/schemas";
import { measureKeyPages, type PsiResult } from "./psi";
import { getJson, putJson, runKey } from "./store";
import { CATEGORY_ORDER, scoreCategories } from "./score";
import type { FindingDraft } from "./types";

export type RunEnv = Pick<
  CloudflareEnv,
  "DB" | "AUDIT_STORE" | "ANTHROPIC_API_KEY" | "WEBFLOW_MCP_URL" | "APP_URL" | "RESEND_API_KEY" | "EMAIL_FROM" | "PSI_API_KEY" | "PERPLEXITY_API_KEY"
>;

// Deterministic findings produced outside the agent, handed to stepAnalyze via KV.
interface ExtraFindings {
  findings: FindingDraft[];
}

async function loadRun(env: RunEnv, runId: string) {
  const db = dbFromEnv(env);
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) throw new Error(`run ${runId} not found`);
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId) });
  if (!site) throw new Error(`site ${run.siteId} not found`);
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId) });
  const connection = site.connectionId
    ? await db.query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, site.connectionId) })
    : null;
  return { db, run, site, client, connection };
}

// Step 1: mark running and make sure the Webflow token is usable.
export async function stepPrepare(env: RunEnv, runId: string): Promise<{ connectionId: string }> {
  const { db, run, connection } = await loadRun(env, runId);
  await db.update(schema.runs).set({ status: "running", startedAt: nowIso(), error: null, model: MODEL }).where(eq(schema.runs.id, run.id));
  if (!connection || connection.revokedAt) throw new Error("Site has no active Webflow connection");
  await ensureFreshConnection(env, connection);
  return { connectionId: connection.id };
}

// Step 2: measured Core Web Vitals for the key pages (PageSpeed Insights).
// Never fails the run: an outage becomes a perf.psi-unavailable finding.
export async function stepMetrics(env: RunEnv, runId: string): Promise<{ pages: number; passing: number }> {
  const { run, site } = await loadRun(env, runId);
  const emit = createEventSink(env, run.id);
  await emit("status", `Measuring Core Web Vitals for ${Math.min(site.keyPages.length || 1, 5)} key page(s)`);
  let result: PsiResult;
  try {
    result = await measureKeyPages(env, run.id, site.id, site.baseUrl, site.keyPages);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await emit("warning", `PageSpeed Insights failed: ${msg.slice(0, 200)}`);
    result = { pages: [], findings: [], summaryText: `PageSpeed Insights failed: ${msg.slice(0, 200)}`, summary: { pages: 0, passing: 0, unavailable: true } };
  }
  await putJson(env.AUDIT_STORE, runKey(run.id, "psi"), { pages: result.pages, summary: result.summary, summaryText: result.summaryText });
  await putJson(env.AUDIT_STORE, runKey(run.id, "psi-findings"), { findings: result.findings } satisfies ExtraFindings);
  const ok = result.pages.filter((p) => p.ok).length;
  await emit(ok ? "status" : "warning", ok ? `PageSpeed measured ${ok} page(s); ${result.summary.passing} pass Core Web Vitals` : "PageSpeed Insights returned no measurements");
  return { pages: result.pages.length, passing: result.summary.passing };
}

// Step 3: the agent audits the site; raw outputs go to KV.
export async function stepAgent(env: RunEnv, runId: string): Promise<{ reportChars: number; blockedHosts: number }> {
  const { db, run, site, client, connection } = await loadRun(env, runId);
  if (!connection) throw new Error("Site has no active Webflow connection");
  const fresh = await ensureFreshConnection(env, connection);
  const psi = await getJson<{ summaryText: string | null }>(env.AUDIT_STORE, runKey(run.id, "psi"));

  // Open findings from the last complete run, so the agent re-verifies them.
  const previousRun = await db.query.runs.findFirst({
    where: and(eq(schema.runs.siteId, site.id), eq(schema.runs.status, "complete")),
    orderBy: desc(schema.runs.createdAt),
  });
  let previous: PreviousFinding[] = [];
  if (previousRun) {
    const rows = await db.query.findings.findMany({ where: and(eq(schema.findings.runId, previousRun.id), eq(schema.findings.ignored, false)) });
    previous = rows.map((f) => ({ checkId: f.checkId, pagePath: f.pagePath, subject: (f.data?.subject as string | undefined) ?? null }));
  }

  const out = await runAuditAgent({
    env,
    runId: run.id,
    site,
    clientName: client?.name ?? "Client",
    connection: fresh,
    previous,
    psiSummary: psi?.summaryText ?? null,
    emit: createEventSink(env, run.id),
  });
  await putJson(env.AUDIT_STORE, runKey(run.id, "report-text"), { text: out.reportText, blockedHosts: out.blockedHosts });
  await putJson(env.AUDIT_STORE, runKey(run.id, "transcript"), out.messages);
  await db.update(schema.runs).set({ usage: out.usage }).where(eq(schema.runs.id, run.id));
  return { reportChars: out.reportText.length, blockedHosts: out.blockedHosts.length };
}

// Step 3b: turn the written report into validated JSON. Its own step so a
// failure here is retried without re-running the whole agent conversation.
export async function stepStructure(env: RunEnv, runId: string): Promise<{ findings: number; proposals: number }> {
  const { db, run } = await loadRun(env, runId);
  const stored = await getJson<{ text: string }>(env.AUDIT_STORE, runKey(run.id, "report-text"));
  if (!stored?.text) throw new Error("audit report text missing");
  const usage = run.usage ?? emptyUsage();
  const report = await structureAuditReport(env, stored.text, usage, createEventSink(env, run.id));
  await putJson(env.AUDIT_STORE, runKey(run.id, "report"), report);
  await db.update(schema.runs).set({ usage, agentSummary: report.summary, highlights: report.highlights }).where(eq(schema.runs.id, run.id));
  return { findings: report.findings.length, proposals: report.proposals.length };
}

// Step 4: ask AI assistants the customer's questions and record how the brand
// shows up. Never fails the run.
export async function stepAiVisibility(env: RunEnv, runId: string): Promise<{ answers: number; mentioned: number }> {
  const { db, run, site } = await loadRun(env, runId);
  const report = await getJson<AuditReport>(env.AUDIT_STORE, runKey(runId, "report"));
  if (!report) throw new Error("audit report missing");
  const emit = createEventSink(env, run.id);
  const usage = run.usage ?? emptyUsage();
  const prompts = site.aiPrompts?.length ? site.aiPrompts : report.aiPrompts;
  const out = await sampleAiVisibility({
    env,
    siteHost: new URL(site.baseUrl).host,
    brandName: report.siteFacts.brandName || site.name,
    brandAliases: report.siteFacts.brandAliases ?? [],
    keyFacts: report.siteFacts.keyFacts ?? [],
    prompts,
    usage,
    emit,
  });
  for (let i = 0; i < out.answers.length; i += 5) {
    await db.insert(schema.aiAnswers).values(
      out.answers.slice(i, i + 5).map((a) => ({
        id: newId(),
        runId: run.id,
        siteId: site.id,
        prompt: a.prompt,
        engine: a.engine,
        iteration: a.iteration,
        mentioned: a.mentioned,
        cited: a.cited,
        recommended: a.recommended,
        answer: a.answer.slice(0, 20_000),
        citations: a.citations.slice(0, 20),
        issues: a.issues,
      })),
    );
  }
  await putJson(env.AUDIT_STORE, runKey(run.id, "ai-findings"), { findings: out.findings } satisfies ExtraFindings);
  await putJson(env.AUDIT_STORE, runKey(run.id, "ai-summary"), out.summary);
  await db.update(schema.runs).set({ usage }).where(eq(schema.runs.id, run.id));
  return { answers: out.summary.answers, mentioned: out.summary.mentioned };
}

// Step 5: score, diff against the previous run, persist findings and proposals.
export async function stepAnalyze(env: RunEnv, runId: string): Promise<{ findings: number; overall: number }> {
  const { db, run, site } = await loadRun(env, runId);
  const report = await getJson<AuditReport>(env.AUDIT_STORE, runKey(runId, "report"));
  if (!report) throw new Error("audit report missing");
  const psi = await getJson<{ summary: RunSummary["perf"] }>(env.AUDIT_STORE, runKey(runId, "psi"));
  const psiExtra = await getJson<ExtraFindings>(env.AUDIT_STORE, runKey(runId, "psi-findings"));
  const aiExtra = await getJson<ExtraFindings>(env.AUDIT_STORE, runKey(runId, "ai-findings"));
  const aiSummary = await getJson<RunSummary["aiVisibility"]>(env.AUDIT_STORE, runKey(runId, "ai-summary"));

  const drafts: { draft: FindingDraft; index: number }[] = [];
  report.findings.forEach((f, index) => {
    if (!isCheckId(f.checkId)) return;
    if (CHECKS[f.checkId].deterministic) return; // code produces these, not the agent
    drafts.push({
      index,
      draft: {
        category: CHECKS[f.checkId].category,
        checkId: f.checkId,
        severity: f.severity,
        confidence: f.confidence,
        effort: f.effort,
        title: f.title,
        detail: f.detail,
        pagePath: f.pagePath ?? undefined,
        webflowPageId: f.webflowPageId ?? undefined,
        subject: f.subject ?? undefined,
        data: { subject: f.subject, evidence: f.evidence },
      },
    });
  });
  // Deterministic findings get indexes past the agent's so proposals can't
  // point at them.
  let extraIndex = report.findings.length;
  for (const d of [...(psiExtra?.findings ?? []), ...(aiExtra?.findings ?? [])]) {
    if (!isCheckId(d.checkId)) continue;
    drafts.push({ index: extraIndex++, draft: d });
  }

  // Ignore rules suppress findings from scoring and from the "open" list.
  const rules = await db.query.ignoreRules.findMany({ where: eq(schema.ignoreRules.siteId, site.id) });
  const isIgnored = (f: FindingDraft) => rules.some((r) => r.checkId === f.checkId && (r.pagePath === null || r.pagePath === f.pagePath));

  const withMeta = await Promise.all(
    drafts.map(async ({ draft, index }) => ({
      draft,
      index,
      id: newId(),
      fingerprint: (await sha256Hex(`${draft.checkId}|${draft.pagePath ?? ""}|${draft.subject ?? ""}`)).slice(0, 24),
      ignored: isIgnored(draft),
    })),
  );
  // Collapse accidental duplicates (same fingerprint reported twice).
  const seen = new Set<string>();
  const unique = withMeta.filter((f) => (seen.has(f.fingerprint) ? false : (seen.add(f.fingerprint), true)));
  const active = unique.filter((f) => !f.ignored);
  const { scores, overall } = scoreCategories(active.map((f) => f.draft));

  // Persist findings in small chunks (D1 caps bound parameters per statement).
  const findingRows = unique.map((f) => ({
    id: f.id,
    runId: run.id,
    siteId: site.id,
    category: f.draft.category,
    checkId: f.draft.checkId,
    severity: f.draft.severity,
    title: f.draft.title,
    detail: f.draft.detail ?? null,
    pagePath: f.draft.pagePath ?? null,
    webflowPageId: f.draft.webflowPageId ?? null,
    fingerprint: f.fingerprint,
    data: f.draft.data ?? null,
    ignored: f.ignored,
    confidence: f.draft.confidence ?? null,
    effort: f.draft.effort ?? null,
  }));
  for (let i = 0; i < findingRows.length; i += 6) {
    await db.insert(schema.findings).values(findingRows.slice(i, i + 6));
  }

  // Finding lifecycle across runs.
  const states = await db.query.findingStates.findMany({ where: eq(schema.findingStates.siteId, site.id) });
  const stateByFp = new Map(states.map((s) => [s.fingerprint, s]));
  const seenFps = new Set(active.map((f) => f.fingerprint));
  let newFindings = 0;
  let resolvedFindings = 0;
  const now = nowIso();
  for (const fp of seenFps) {
    const existing = stateByFp.get(fp);
    if (!existing) {
      newFindings++;
      await db.insert(schema.findingStates).values({ siteId: site.id, fingerprint: fp, status: "open", firstSeenRunId: run.id, lastSeenRunId: run.id, updatedAt: now });
    } else if (existing.status === "fixed") {
      await db
        .update(schema.findingStates)
        .set({ status: "open", lastSeenRunId: run.id, resolvedRunId: null, updatedAt: now })
        .where(and(eq(schema.findingStates.siteId, site.id), eq(schema.findingStates.fingerprint, fp)));
    } else {
      await db
        .update(schema.findingStates)
        .set({ lastSeenRunId: run.id, updatedAt: now })
        .where(and(eq(schema.findingStates.siteId, site.id), eq(schema.findingStates.fingerprint, fp)));
    }
  }
  const toResolve = states.filter((s) => s.status === "open" && !seenFps.has(s.fingerprint)).map((s) => s.fingerprint);
  for (let i = 0; i < toResolve.length; i += 50) {
    const chunk = toResolve.slice(i, i + 50);
    await db
      .update(schema.findingStates)
      .set({ status: "fixed", resolvedRunId: run.id, updatedAt: now })
      .where(and(eq(schema.findingStates.siteId, site.id), inArray(schema.findingStates.fingerprint, chunk)));
    resolvedFindings += chunk.length;
  }

  // Fix proposals: one open proposal per (fingerprint, action); re-proposing the
  // same fix on the next run must not create duplicates.
  const byIndex = new Map(unique.map((f) => [f.index, f]));
  const openProposals = await db.query.fixProposals.findMany({
    where: and(eq(schema.fixProposals.siteId, site.id), inArray(schema.fixProposals.status, ["proposed", "approved", "applying"])),
  });
  const openKeys = new Set(openProposals.map((p) => `${p.fingerprint}|${p.action}`));
  let proposals = 0;
  for (const p of report.proposals) {
    if (p.action === "manual") continue;
    const f = byIndex.get(p.findingIndex);
    if (!f || f.ignored) continue;
    const key = `${f.fingerprint}|${p.action}`;
    if (openKeys.has(key)) continue;
    openKeys.add(key);
    proposals++;
    await db.insert(schema.fixProposals).values({
      id: newId(),
      siteId: site.id,
      findingId: f.id,
      fingerprint: f.fingerprint,
      status: "proposed",
      action: p.action,
      title: p.title,
      risk: p.risk,
      target: p.target,
      proposal: { changes: p.changes },
      previous: { changes: p.changes.map((c) => ({ field: c.field, value: c.from })) },
      rationale: p.rationale,
      effort: p.effort ?? null,
    });
  }

  // Regressions against the previous completed run: what a publish broke.
  const previousRun = await db.query.runs.findFirst({
    where: and(eq(schema.runs.siteId, site.id), eq(schema.runs.status, "complete"), ne(schema.runs.id, run.id)),
    orderBy: desc(schema.runs.createdAt),
  });
  // AI-sample findings are about assistants, not the site build, so they are
  // not publish regressions.
  const newCriticalHigh = active.filter((f) => !stateByFp.has(f.fingerprint) && f.draft.category !== "ai" && (f.draft.severity === "critical" || f.draft.severity === "high")).length;
  const regressions: RunSummary["regressions"] = {
    scoreDelta: previousRun?.scoreOverall === null || previousRun?.scoreOverall === undefined ? null : overall - previousRun.scoreOverall,
    newCriticalHigh,
  };

  const bySeverity = Object.fromEntries(["critical", "high", "medium", "low", "info"].map((s) => [s, 0])) as Record<Severity, number>;
  const byCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<CategoryKey, number>;
  for (const f of active) {
    bySeverity[f.draft.severity]++;
    byCategory[f.draft.category]++;
  }
  const summary: RunSummary = {
    pagesTotal: report.siteFacts.pagesTotal,
    pagesReviewed: report.siteFacts.pagesReviewed,
    findingsBySeverity: bySeverity,
    findingsByCategory: byCategory,
    newFindings,
    resolvedFindings,
    proposals,
    perf: psi?.summary ?? undefined,
    aiVisibility: aiSummary ?? undefined,
    regressions,
  };
  await db.update(schema.runs).set({ scoreOverall: overall, scores, summary }).where(eq(schema.runs.id, run.id));
  return { findings: active.length, overall };
}

// Step 4: mark complete (or failed), advance the site's schedule, and email
// the client's contact the results when they asked for them.
export async function stepFinalize(env: RunEnv, runId: string, error?: string): Promise<void> {
  const { db, run, site, client } = await loadRun(env, runId);
  await db
    .update(schema.runs)
    .set({ status: error ? "failed" : "complete", finishedAt: nowIso(), error: error ?? null })
    .where(eq(schema.runs.id, run.id));
  if (!error) await db.update(schema.sites).set({ lastRunId: run.id }).where(eq(schema.sites.id, site.id));
  const emit = createEventSink(env, run.id);
  if (error) {
    await emit("error", error.slice(0, 300));
    return;
  }
  const to = client?.notifyResults ? parseRecipients(client.notifyEmail) : [];
  if (!client || to.length === 0) return;
  const fresh = await db.query.runs.findFirst({ where: eq(schema.runs.id, run.id) });
  const previous = await db.query.runs.findFirst({
    where: and(eq(schema.runs.siteId, site.id), eq(schema.runs.status, "complete"), ne(schema.runs.id, run.id)),
    orderBy: desc(schema.runs.createdAt),
  });
  const summary = fresh?.summary;
  const result = await sendEmail(
    env,
    "results",
    resultsEmail({
      to,
      clientName: client.name,
      siteName: site.name,
      siteHost: new URL(site.baseUrl).host,
      score: fresh?.scoreOverall ?? null,
      previousScore: previous?.scoreOverall ?? null,
      counts: summary?.findingsBySeverity ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      highlights: fresh?.highlights ?? [],
      summary: fresh?.agentSummary ?? null,
      proposals: summary?.proposals ?? 0,
      appUrl: appUrl(env),
      runId: run.id,
      trigger: run.trigger,
      newCriticalHigh: summary?.regressions?.newCriticalHigh ?? 0,
      aiVisibility: summary?.aiVisibility ?? null,
    }),
    site.id,
  );
  await emit("status", result === "sent" ? `Results emailed to ${to.join(", ")}` : result === "skipped" ? "Results email skipped (email not configured)" : "Results email failed (see activity log)");
}

export async function runAuditInline(env: RunEnv, runId: string): Promise<void> {
  try {
    await stepPrepare(env, runId);
    await stepMetrics(env, runId);
    await stepAgent(env, runId);
    await stepStructure(env, runId);
    await stepAiVisibility(env, runId).catch((e) => console.warn("ai visibility failed", e));
    await stepAnalyze(env, runId);
    await stepFinalize(env, runId);
  } catch (e) {
    await stepFinalize(env, runId, (e as Error).message ?? String(e)).catch(() => {});
    throw e;
  }
}
