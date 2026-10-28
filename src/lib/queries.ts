import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Client, Finding, FixProposal, Run, RunEvent, Site, WebflowConnection } from "@/db/schema";

export interface SiteCard {
  site: Site;
  latest: Run | null;
  previous: Run | null;
  openBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
  openFindings: number;
  pendingFixes: number;
  // Id of the queued/running audit, if any.
  running: string | null;
  // Overall scores of recent completed runs, oldest first (for sparklines).
  history: (number | null)[];
}

export interface ClientCard {
  client: Client;
  sites: SiteCard[];
  connected: boolean;
}

const OPEN_PROPOSAL_STATUSES = ["proposed", "approved", "applying"] as const;
const SUPPRESSED = new Set(["ignored", "false_positive", "fixed"]);

// Small helper for D1's bound-parameter cap.
async function chunked<T, R>(items: T[], size: number, fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

// Builds cards for many sites with a fixed number of queries instead of
// several per site: recent runs, open findings of each latest run, their
// lifecycle states, and open proposals, all fetched in batches.
export async function siteCards(sites: Site[]): Promise<SiteCard[]> {
  if (sites.length === 0) return [];
  const db = await getDb();
  const siteIds = sites.map((s) => s.id);

  const runs = await chunked(siteIds, 60, (ids) => db.query.runs.findMany({ where: inArray(schema.runs.siteId, ids), orderBy: desc(schema.runs.createdAt) }));
  const runsBySite = new Map<string, Run[]>();
  for (const r of runs) {
    const list = runsBySite.get(r.siteId) ?? [];
    if (list.length < 12) list.push(r);
    runsBySite.set(r.siteId, list);
  }

  const latestIds: string[] = [];
  for (const list of runsBySite.values()) {
    const latest = list.find((r) => r.status === "complete");
    if (latest) latestIds.push(latest.id);
  }
  const findings = latestIds.length
    ? await chunked(latestIds, 60, (ids) => db.query.findings.findMany({ where: and(inArray(schema.findings.runId, ids), eq(schema.findings.ignored, false)) }))
    : [];
  const states = findings.length
    ? await chunked(siteIds, 60, (ids) => db.query.findingStates.findMany({ where: and(inArray(schema.findingStates.siteId, ids), inArray(schema.findingStates.status, ["ignored", "false_positive", "fixed"])) }))
    : [];
  const suppressed = new Set(states.map((s) => `${s.siteId}|${s.fingerprint}`));

  const proposals = await chunked(siteIds, 60, (ids) =>
    db.query.fixProposals.findMany({ where: and(inArray(schema.fixProposals.siteId, ids), inArray(schema.fixProposals.status, [...OPEN_PROPOSAL_STATUSES])), columns: { siteId: true } }),
  );
  const pendingBySite = new Map<string, number>();
  for (const p of proposals) pendingBySite.set(p.siteId, (pendingBySite.get(p.siteId) ?? 0) + 1);

  return sites.map((site) => {
    const recent = runsBySite.get(site.id) ?? [];
    const completed = recent.filter((r) => r.status === "complete");
    const latest = completed[0] ?? null;
    const previous = completed[1] ?? null;
    const openBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let openFindings = 0;
    if (latest) {
      for (const f of findings) {
        if (f.runId !== latest.id || suppressed.has(`${site.id}|${f.fingerprint}`)) continue;
        openFindings++;
        openBySeverity[f.severity]++;
      }
    }
    return {
      site,
      latest,
      previous,
      openBySeverity,
      openFindings,
      pendingFixes: pendingBySite.get(site.id) ?? 0,
      running: recent.find((r) => r.status === "queued" || r.status === "running")?.id ?? null,
      history: completed.map((r) => r.scoreOverall).reverse(),
    };
  });
}

export async function dashboardData(): Promise<ClientCard[]> {
  const db = await getDb();
  const [clients, sites, connections] = await Promise.all([
    db.query.clients.findMany({ orderBy: schema.clients.name }),
    db.query.sites.findMany({ orderBy: schema.sites.name }),
    db.query.webflowConnections.findMany({ columns: { clientId: true, revokedAt: true } }),
  ]);
  const cards = await siteCards(sites);
  return clients.map((client) => ({
    client,
    sites: cards.filter((c) => c.site.clientId === client.id),
    connected: connections.some((c) => c.clientId === client.id && !c.revokedAt),
  }));
}

// Findings of a run that are still open (not ignored, not marked false positive).
export async function openFindingsForRun(siteId: string, runId: string): Promise<Finding[]> {
  const db = await getDb();
  const rows = await db.query.findings.findMany({ where: and(eq(schema.findings.runId, runId), eq(schema.findings.ignored, false)) });
  if (rows.length === 0) return [];
  const states = await db.query.findingStates.findMany({
    where: and(eq(schema.findingStates.siteId, siteId), inArray(schema.findingStates.status, ["ignored", "false_positive", "fixed"])),
    columns: { fingerprint: true },
  });
  const suppressed = new Set(states.map((s) => s.fingerprint));
  return rows.filter((r) => !suppressed.has(r.fingerprint));
}

export async function siteDetail(siteId: string) {
  const db = await getDb();
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, siteId) });
  if (!site) return null;
  const [client, connection, runs, proposals, ignoreRules, activity] = await Promise.all([
    db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId) }),
    site.connectionId ? db.query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, site.connectionId) }) : Promise.resolve(undefined),
    db.query.runs.findMany({ where: eq(schema.runs.siteId, site.id), orderBy: desc(schema.runs.createdAt), limit: 30 }),
    db.query.fixProposals.findMany({ where: eq(schema.fixProposals.siteId, site.id), orderBy: desc(schema.fixProposals.createdAt), limit: 100 }),
    db.query.ignoreRules.findMany({ where: eq(schema.ignoreRules.siteId, site.id) }),
    db.query.auditLog.findMany({ where: eq(schema.auditLog.siteId, site.id), orderBy: desc(schema.auditLog.createdAt), limit: 20 }),
  ]);
  const latest = runs.find((r) => r.status === "complete") ?? null;
  const previous = runs.filter((r) => r.status === "complete")[1] ?? null;
  const [findings, metrics] = latest ? await Promise.all([openFindingsForRun(site.id, latest.id), db.query.pageMetrics.findMany({ where: eq(schema.pageMetrics.runId, latest.id) })]) : [[], []];
  const states = findings.length ? await db.query.findingStates.findMany({ where: eq(schema.findingStates.siteId, site.id) }) : [];
  const stateByFp = new Map(states.map((s) => [s.fingerprint, s]));
  return { site, client: client!, connection: connection ?? null, runs, latest, previous, findings, stateByFp, proposals, ignoreRules, activity, metrics };
}

export async function runDetail(runId: string) {
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) return null;
  const [site, findings, events, metrics, aiAnswers] = await Promise.all([
    db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId) }),
    db.query.findings.findMany({ where: eq(schema.findings.runId, run.id) }),
    db.query.runEvents.findMany({ where: eq(schema.runEvents.streamId, run.id), orderBy: asc(schema.runEvents.seq), limit: 500 }),
    db.query.pageMetrics.findMany({ where: eq(schema.pageMetrics.runId, run.id) }),
    db.query.aiAnswers.findMany({ where: eq(schema.aiAnswers.runId, run.id), orderBy: [asc(schema.aiAnswers.prompt), asc(schema.aiAnswers.engine), asc(schema.aiAnswers.iteration)] }),
  ]);
  const client = site ? await db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId) }) : null;
  const states = findings.length ? await db.query.findingStates.findMany({ where: eq(schema.findingStates.siteId, run.siteId) }) : [];
  const stateByFp = new Map(states.map((s) => [s.fingerprint, s]));
  const findingIds = findings.map((f) => f.id);
  const proposals = findingIds.length ? await chunked(findingIds, 60, (ids) => db.query.fixProposals.findMany({ where: inArray(schema.fixProposals.findingId, ids) })) : [];
  return { run, site: site!, client, findings, stateByFp, proposals, events, metrics, aiAnswers };
}

// Everything the public report shows, by share token. No internal ids leak:
// findings are returned without their proposals or actions.
export async function sharedReport(token: string) {
  if (!/^[a-z0-9]{18}$/.test(token)) return null;
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: and(eq(schema.runs.shareToken, token), eq(schema.runs.status, "complete")) });
  if (!run) return null;
  const [site, findings, metrics, aiAnswers, previous] = await Promise.all([
    db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId) }),
    openFindingsForRun(run.siteId, run.id),
    db.query.pageMetrics.findMany({ where: eq(schema.pageMetrics.runId, run.id) }),
    db.query.aiAnswers.findMany({ where: eq(schema.aiAnswers.runId, run.id), orderBy: [asc(schema.aiAnswers.prompt), asc(schema.aiAnswers.engine), asc(schema.aiAnswers.iteration)] }),
    db.query.runs.findFirst({
      where: and(eq(schema.runs.siteId, run.siteId), eq(schema.runs.status, "complete"), lt(schema.runs.createdAt, run.createdAt)),
      orderBy: desc(schema.runs.createdAt),
      columns: { scoreOverall: true, scores: true, finishedAt: true },
    }),
  ]);
  if (!site) return null;
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId), columns: { name: true } });
  const done = await db.query.fixProposals.findMany({
    where: and(eq(schema.fixProposals.siteId, site.id), inArray(schema.fixProposals.status, ["applied", "resolved"])),
    columns: { title: true, status: true, appliedAt: true },
  });
  return { run, site, client, findings, previous: previous ?? null, fixesDone: done.filter((d) => d.appliedAt && d.appliedAt >= run.createdAt), metrics, aiAnswers };
}

// The client hub: everything the client's tabs show, in one batched fetch.
export async function clientDetail(clientId: string) {
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) return null;
  const [sites, connections] = await Promise.all([
    db.query.sites.findMany({ where: eq(schema.sites.clientId, client.id), orderBy: schema.sites.name }),
    db.query.webflowConnections.findMany({ where: eq(schema.webflowConnections.clientId, client.id), orderBy: desc(schema.webflowConnections.createdAt) }),
  ]);
  const cards = await siteCards(sites);
  const siteIds = sites.map((s) => s.id);
  const [runs, proposals, activity] = siteIds.length
    ? await Promise.all([
        chunked(siteIds, 60, (ids) => db.query.runs.findMany({ where: inArray(schema.runs.siteId, ids), orderBy: desc(schema.runs.createdAt), limit: 60 })),
        chunked(siteIds, 60, (ids) => db.query.fixProposals.findMany({ where: inArray(schema.fixProposals.siteId, ids), orderBy: desc(schema.fixProposals.createdAt), limit: 150 })),
        chunked(siteIds, 60, (ids) => db.query.auditLog.findMany({ where: inArray(schema.auditLog.siteId, ids), orderBy: desc(schema.auditLog.createdAt), limit: 15 })),
      ])
    : [[], [], []];
  runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  proposals.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  activity.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const completed = runs.filter((r) => r.status === "complete");
  const latest = completed[0] ?? null;
  const previousOfLatest = latest ? (completed.find((r) => r.siteId === latest.siteId && r.id !== latest.id) ?? null) : null;
  const latestFindings = latest ? await openFindingsForRun(latest.siteId, latest.id) : [];
  const pendingFixes = proposals.filter((p) => OPEN_PROPOSAL_STATUSES.includes(p.status as (typeof OPEN_PROPOSAL_STATUSES)[number]));
  return { client, sites: cards, connections, runs, latest, previousOfLatest, latestFindings, proposals, pendingFixes, activity: activity.slice(0, 15) };
}

// Just what the client header and tabs need.
export async function clientHeader(clientId: string) {
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) return null;
  const sites = await db.query.sites.findMany({ where: eq(schema.sites.clientId, client.id), columns: { id: true, connectionId: true } });
  const siteIds = sites.map((s) => s.id);
  const [live, pending] = siteIds.length
    ? await Promise.all([
        chunked(siteIds, 60, (ids) => db.query.runs.findMany({ where: and(inArray(schema.runs.siteId, ids), inArray(schema.runs.status, ["queued", "running"])), columns: { id: true, siteId: true } })),
        chunked(siteIds, 60, (ids) => db.query.fixProposals.findMany({ where: and(inArray(schema.fixProposals.siteId, ids), inArray(schema.fixProposals.status, [...OPEN_PROPOSAL_STATUSES])), columns: { id: true } })),
      ])
    : [[], []];
  const hasCompleted = siteIds.length
    ? (await chunked(siteIds, 60, (ids) => db.query.runs.findMany({ where: and(inArray(schema.runs.siteId, ids), eq(schema.runs.status, "complete")), columns: { id: true }, limit: 1 }))).length > 0
    : false;
  return { client, siteCount: sites.length, connectedCount: sites.filter((s) => s.connectionId).length, running: live, pendingFixes: pending.length, hasCompleted };
}

export async function proposalDetail(proposalId: string) {
  const db = await getDb();
  const proposal = await db.query.fixProposals.findFirst({ where: eq(schema.fixProposals.id, proposalId) });
  if (!proposal) return null;
  const [site, finding, events] = await Promise.all([
    db.query.sites.findFirst({ where: eq(schema.sites.id, proposal.siteId) }),
    proposal.findingId ? db.query.findings.findFirst({ where: eq(schema.findings.id, proposal.findingId) }) : Promise.resolve(undefined),
    db.query.runEvents.findMany({ where: eq(schema.runEvents.streamId, proposal.id), orderBy: asc(schema.runEvents.seq), limit: 300 }),
  ]);
  const client = site ? await db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId), columns: { id: true, name: true } }) : null;
  return { proposal, site: site!, client: client ?? null, finding: finding ?? null, events };
}

// Events after a sequence number, for live polling.
export async function eventsAfter(streamId: string, afterSeq: number): Promise<RunEvent[]> {
  const db = await getDb();
  return db.query.runEvents.findMany({
    where: and(eq(schema.runEvents.streamId, streamId), gt(schema.runEvents.seq, afterSeq)),
    orderBy: asc(schema.runEvents.seq),
    limit: 200,
  });
}

async function withSites<T extends { siteId: string }>(rows: T[]): Promise<(T & { site: Site | undefined })[]> {
  const db = await getDb();
  const siteIds = [...new Set(rows.map((r) => r.siteId))];
  const sites = siteIds.length ? await chunked(siteIds, 60, (ids) => db.query.sites.findMany({ where: inArray(schema.sites.id, ids) })) : [];
  const byId = new Map(sites.map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, site: byId.get(r.siteId) }));
}

export async function pendingFixesAcrossPortfolio(): Promise<(FixProposal & { site: Site | undefined })[]> {
  const db = await getDb();
  const rows = await db.query.fixProposals.findMany({
    where: inArray(schema.fixProposals.status, [...OPEN_PROPOSAL_STATUSES]),
    orderBy: desc(schema.fixProposals.createdAt),
    limit: 50,
  });
  return withSites(rows);
}

export async function pendingFixCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.query.fixProposals.findMany({ where: inArray(schema.fixProposals.status, [...OPEN_PROPOSAL_STATUSES]), columns: { id: true } });
  return rows.length;
}

export async function proposalsByStatus(statuses: FixProposal["status"][], limit = 30): Promise<(FixProposal & { site: Site | undefined })[]> {
  const db = await getDb();
  const rows = await db.query.fixProposals.findMany({ where: inArray(schema.fixProposals.status, statuses), orderBy: desc(schema.fixProposals.createdAt), limit });
  return withSites(rows);
}

export async function recentActivity(limit = 25) {
  const db = await getDb();
  return db.query.auditLog.findMany({ orderBy: desc(schema.auditLog.createdAt), limit });
}

export async function recentRuns(limit = 20): Promise<(Run & { site: Site | undefined })[]> {
  const db = await getDb();
  const runs = await db.query.runs.findMany({ orderBy: desc(schema.runs.createdAt), limit });
  return withSites(runs);
}

export { SUPPRESSED };
export type { WebflowConnection };
