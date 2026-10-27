import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Client, Finding, FixProposal, Run, RunEvent, Site, WebflowConnection } from "@/db/schema";

export interface SiteCard {
  site: Site;
  latest: Run | null;
  previous: Run | null;
  openBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
  openFindings: number;
  pendingFixes: number;
  running: boolean;
  // Overall scores of recent completed runs, oldest first (for sparklines).
  history: (number | null)[];
}

export interface ClientCard {
  client: Client;
  sites: SiteCard[];
  connected: boolean;
}

const OPEN_PROPOSAL_STATUSES = ["proposed", "approved", "applying"] as const;

export async function dashboardData(): Promise<ClientCard[]> {
  const db = await getDb();
  const clients = await db.query.clients.findMany({ orderBy: schema.clients.name });
  const sites = await db.query.sites.findMany({ orderBy: schema.sites.name });
  const connections = await db.query.webflowConnections.findMany();
  const out: ClientCard[] = [];
  for (const client of clients) {
    const cards: SiteCard[] = [];
    for (const site of sites.filter((s) => s.clientId === client.id)) cards.push(await siteCard(site));
    out.push({ client, sites: cards, connected: connections.some((c) => c.clientId === client.id && !c.revokedAt) });
  }
  return out;
}

export async function siteCard(site: Site): Promise<SiteCard> {
  const db = await getDb();
  const recent = await db.query.runs.findMany({ where: eq(schema.runs.siteId, site.id), orderBy: desc(schema.runs.createdAt), limit: 12 });
  const completed = recent.filter((r) => r.status === "complete");
  const latest = completed[0] ?? null;
  const previous = completed[1] ?? null;
  const openBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let openFindings = 0;
  if (latest) {
    const open = await openFindingsForRun(site.id, latest.id);
    openFindings = open.length;
    for (const f of open) openBySeverity[f.severity]++;
  }
  const pending = await db.query.fixProposals.findMany({
    where: and(eq(schema.fixProposals.siteId, site.id), inArray(schema.fixProposals.status, [...OPEN_PROPOSAL_STATUSES])),
    columns: { id: true },
  });
  return {
    site,
    latest,
    previous,
    openBySeverity,
    openFindings,
    pendingFixes: pending.length,
    running: recent.some((r) => r.status === "queued" || r.status === "running"),
    history: completed.map((r) => r.scoreOverall).reverse(),
  };
}

// Findings of a run that are still open (not ignored, not marked false positive).
export async function openFindingsForRun(siteId: string, runId: string): Promise<Finding[]> {
  const db = await getDb();
  const rows = await db.query.findings.findMany({ where: and(eq(schema.findings.runId, runId), eq(schema.findings.ignored, false)) });
  if (rows.length === 0) return [];
  const fps = [...new Set(rows.map((r) => r.fingerprint))];
  const suppressed = new Set<string>();
  for (let i = 0; i < fps.length; i += 80) {
    const states = await db.query.findingStates.findMany({
      where: and(eq(schema.findingStates.siteId, siteId), inArray(schema.findingStates.fingerprint, fps.slice(i, i + 80))),
    });
    for (const s of states) if (s.status === "ignored" || s.status === "false_positive") suppressed.add(s.fingerprint);
  }
  return rows.filter((r) => !suppressed.has(r.fingerprint));
}

export async function siteDetail(siteId: string) {
  const db = await getDb();
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, siteId) });
  if (!site) return null;
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId) });
  const connection = site.connectionId ? ((await db.query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, site.connectionId) })) ?? null) : null;
  const runs = await db.query.runs.findMany({ where: eq(schema.runs.siteId, site.id), orderBy: desc(schema.runs.createdAt), limit: 30 });
  const latest = runs.find((r) => r.status === "complete") ?? null;
  const previous = runs.filter((r) => r.status === "complete")[1] ?? null;
  const findings = latest ? await openFindingsForRun(site.id, latest.id) : [];
  const states = findings.length ? await db.query.findingStates.findMany({ where: eq(schema.findingStates.siteId, site.id) }) : [];
  const stateByFp = new Map(states.map((s) => [s.fingerprint, s]));
  const proposals = await db.query.fixProposals.findMany({ where: eq(schema.fixProposals.siteId, site.id), orderBy: desc(schema.fixProposals.createdAt), limit: 100 });
  const ignoreRules = await db.query.ignoreRules.findMany({ where: eq(schema.ignoreRules.siteId, site.id) });
  const activity = await db.query.auditLog.findMany({ where: eq(schema.auditLog.siteId, site.id), orderBy: desc(schema.auditLog.createdAt), limit: 20 });
  return { site, client: client!, connection, runs, latest, previous, findings, stateByFp, proposals, ignoreRules, activity };
}

export async function runDetail(runId: string) {
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) return null;
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId) });
  const client = site ? await db.query.clients.findFirst({ where: eq(schema.clients.id, site.clientId) }) : null;
  const findings = await db.query.findings.findMany({ where: eq(schema.findings.runId, run.id) });
  const states = findings.length ? await db.query.findingStates.findMany({ where: eq(schema.findingStates.siteId, run.siteId) }) : [];
  const stateByFp = new Map(states.map((s) => [s.fingerprint, s]));
  const findingIds = findings.map((f) => f.id);
  const proposals = findingIds.length ? await db.query.fixProposals.findMany({ where: inArray(schema.fixProposals.findingId, findingIds.slice(0, 100)) }) : [];
  const events = await db.query.runEvents.findMany({ where: eq(schema.runEvents.streamId, run.id), orderBy: asc(schema.runEvents.seq), limit: 500 });
  return { run, site: site!, client, findings, stateByFp, proposals, events };
}

export async function clientDetail(clientId: string) {
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) return null;
  const sites = await db.query.sites.findMany({ where: eq(schema.sites.clientId, client.id), orderBy: schema.sites.name });
  const connections = await db.query.webflowConnections.findMany({ where: eq(schema.webflowConnections.clientId, client.id), orderBy: desc(schema.webflowConnections.createdAt) });
  const cards: SiteCard[] = [];
  for (const s of sites) cards.push(await siteCard(s));
  return { client, sites: cards, connections };
}

export async function proposalDetail(proposalId: string) {
  const db = await getDb();
  const proposal = await db.query.fixProposals.findFirst({ where: eq(schema.fixProposals.id, proposalId) });
  if (!proposal) return null;
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, proposal.siteId) });
  const finding = proposal.findingId ? ((await db.query.findings.findFirst({ where: eq(schema.findings.id, proposal.findingId) })) ?? null) : null;
  const events = await db.query.runEvents.findMany({ where: eq(schema.runEvents.streamId, proposal.id), orderBy: asc(schema.runEvents.seq), limit: 300 });
  return { proposal, site: site!, finding, events };
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

export async function pendingFixesAcrossPortfolio(): Promise<(FixProposal & { site: Site | undefined })[]> {
  const db = await getDb();
  const rows = await db.query.fixProposals.findMany({
    where: inArray(schema.fixProposals.status, [...OPEN_PROPOSAL_STATUSES]),
    orderBy: desc(schema.fixProposals.createdAt),
    limit: 50,
  });
  const siteIds = [...new Set(rows.map((r) => r.siteId))];
  const sites = siteIds.length ? await db.query.sites.findMany({ where: inArray(schema.sites.id, siteIds) }) : [];
  const byId = new Map(sites.map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, site: byId.get(r.siteId) }));
}

export async function proposalsByStatus(statuses: FixProposal["status"][], limit = 30): Promise<(FixProposal & { site: Site | undefined })[]> {
  const db = await getDb();
  const rows = await db.query.fixProposals.findMany({ where: inArray(schema.fixProposals.status, statuses), orderBy: desc(schema.fixProposals.createdAt), limit });
  const siteIds = [...new Set(rows.map((r) => r.siteId))];
  const sites = siteIds.length ? await db.query.sites.findMany({ where: inArray(schema.sites.id, siteIds) }) : [];
  const byId = new Map(sites.map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, site: byId.get(r.siteId) }));
}

export async function recentActivity(limit = 25) {
  const db = await getDb();
  return db.query.auditLog.findMany({ orderBy: desc(schema.auditLog.createdAt), limit });
}

export async function recentRuns(limit = 20): Promise<(Run & { site: Site | undefined })[]> {
  const db = await getDb();
  const runs = await db.query.runs.findMany({ orderBy: desc(schema.runs.createdAt), limit });
  const siteIds = [...new Set(runs.map((r) => r.siteId))];
  const sites = siteIds.length ? await db.query.sites.findMany({ where: inArray(schema.sites.id, siteIds) }) : [];
  const byId = new Map(sites.map((s) => [s.id, s]));
  return runs.map((r) => ({ ...r, site: byId.get(r.siteId) }));
}

export type { WebflowConnection };
