// What changed for a client over a period: scores then and now per site,
// fixes applied, issues resolved, what is waiting. Feeds the progress card on
// the client overview and the monthly report (email + Slack).

import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Run } from "@/db/schema";

export interface SiteProgress {
  siteId: string;
  name: string;
  score: number | null;
  scoreBefore: number | null;
  // Completed runs in order, oldest first, for the trend line.
  history: (number | null)[];
  openFindings: number | null;
  openBefore: number | null;
  vitalsPassing: { passing: number; pages: number } | null;
  aiMentioned: { now: number; of: number; before: number | null; ofBefore: number | null } | null;
  audits: number;
}

export interface ClientProgress {
  since: string;
  until: string;
  sites: SiteProgress[];
  fixesApplied: number;
  fixesAppliedTitles: string[];
  resolved: number;
  newIssues: number;
  waiting: number;
  audits: number;
  // Null when no site has a score on both ends.
  scoreDelta: number | null;
}

function countOpen(run: Run): number {
  return run.summary ? Object.values(run.summary.findingsBySeverity).reduce((a, b) => a + b, 0) : 0;
}

export async function clientProgress(db: Db, clientId: string, since: Date, until: Date = new Date()): Promise<ClientProgress> {
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();
  const sites = await db.query.sites.findMany({ where: eq(schema.sites.clientId, clientId), orderBy: schema.sites.name });
  const siteIds = sites.map((s) => s.id);
  const empty: ClientProgress = { since: sinceIso, until: untilIso, sites: [], fixesApplied: 0, fixesAppliedTitles: [], resolved: 0, newIssues: 0, waiting: 0, audits: 0, scoreDelta: null };
  if (siteIds.length === 0) return empty;

  const [runs, applied, waitingRows] = await Promise.all([
    db.query.runs.findMany({ where: and(inArray(schema.runs.siteId, siteIds), eq(schema.runs.status, "complete"), lte(schema.runs.createdAt, untilIso)), orderBy: desc(schema.runs.createdAt), limit: 400 }),
    db.query.fixProposals.findMany({
      where: and(inArray(schema.fixProposals.siteId, siteIds), inArray(schema.fixProposals.status, ["applied", "resolved"]), gte(schema.fixProposals.appliedAt, sinceIso), lt(schema.fixProposals.appliedAt, untilIso)),
      columns: { title: true, action: true },
    }),
    db.query.fixProposals.findMany({ where: and(inArray(schema.fixProposals.siteId, siteIds), eq(schema.fixProposals.status, "proposed")), columns: { id: true } }),
  ]);

  let resolved = 0;
  let newIssues = 0;
  let audits = 0;
  const perSite: SiteProgress[] = sites.map((site) => {
    const mine = runs.filter((r) => r.siteId === site.id); // newest first
    const inPeriod = mine.filter((r) => r.createdAt >= sinceIso);
    const latest = mine[0] ?? null;
    // "Before" = the last completed audit before the period began; failing
    // that, the first one inside it (a client who joined this month).
    const before = mine.find((r) => r.createdAt < sinceIso) ?? (inPeriod.length > 1 ? inPeriod[inPeriod.length - 1] : null);
    for (const r of inPeriod) {
      resolved += r.summary?.resolvedFindings ?? 0;
      newIssues += r.summary?.newFindings ?? 0;
    }
    audits += inPeriod.length;
    const ai = latest?.summary?.aiVisibility;
    const aiBefore = before?.summary?.aiVisibility;
    return {
      siteId: site.id,
      name: site.name,
      score: latest?.scoreOverall ?? null,
      scoreBefore: before && before.id !== latest?.id ? (before.scoreOverall ?? null) : null,
      history: [...mine].reverse().map((r) => r.scoreOverall),
      openFindings: latest ? countOpen(latest) : null,
      openBefore: before && before.id !== latest?.id ? countOpen(before) : null,
      vitalsPassing: latest?.summary?.perf && latest.summary.perf.pages > 0 ? { passing: latest.summary.perf.passing, pages: latest.summary.perf.pages } : null,
      aiMentioned: ai && ai.answers > 0 ? { now: ai.mentioned, of: ai.answers, before: aiBefore && aiBefore.answers > 0 ? aiBefore.mentioned : null, ofBefore: aiBefore && aiBefore.answers > 0 ? aiBefore.answers : null } : null,
      audits: inPeriod.length,
    };
  });
  const deltas = perSite.filter((s) => s.score != null && s.scoreBefore != null).map((s) => s.score! - s.scoreBefore!);
  return {
    since: sinceIso,
    until: untilIso,
    sites: perSite,
    fixesApplied: applied.length,
    fixesAppliedTitles: applied.map((p) => p.title ?? p.action),
    resolved,
    newIssues,
    waiting: waitingRows.length,
    audits,
    scoreDelta: deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
  };
}

// A rolling window ending now, for the overview's progress card.
export function lastDays(days: number): { since: Date; until: Date } {
  const until = new Date();
  return { since: new Date(until.getTime() - days * 86_400_000), until };
}

// The calendar month before `now`, as [start, end) plus a label like "October 2026".
export function previousMonth(now: Date): { since: Date; until: Date; key: string; label: string } {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() - 1, 1));
  const key = `${since.getUTCFullYear()}-${String(since.getUTCMonth() + 1).padStart(2, "0")}`;
  const label = since.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { since, until, key, label };
}
