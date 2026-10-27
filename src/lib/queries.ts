import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Client, Finding, Run, Site } from "@/db/schema";

export interface SiteCard {
  site: Site;
  latest: Run | null;
  previous: Run | null;
  openBySeverity: { critical: number; high: number; medium: number };
}

export interface ClientCard {
  client: Client;
  sites: SiteCard[];
  connected: boolean;
}

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
  const completed = await db.query.runs.findMany({
    where: and(eq(schema.runs.siteId, site.id), eq(schema.runs.status, "complete")),
    orderBy: desc(schema.runs.createdAt),
    limit: 2,
  });
  const latest = completed[0] ?? null;
  const previous = completed[1] ?? null;
  const openBySeverity = { critical: 0, high: 0, medium: 0 };
  if (latest) {
    const open = await openFindingsForRun(site.id, latest.id);
    for (const f of open) if (f.severity in openBySeverity) openBySeverity[f.severity as keyof typeof openBySeverity]++;
  }
  return { site, latest, previous, openBySeverity };
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
  const runs = await db.query.runs.findMany({ where: eq(schema.runs.siteId, site.id), orderBy: desc(schema.runs.createdAt), limit: 20 });
  const latest = runs.find((r) => r.status === "complete") ?? null;
  const findings = latest ? await openFindingsForRun(site.id, latest.id) : [];
  const metrics = await db.query.pageMetrics.findMany({ where: eq(schema.pageMetrics.siteId, site.id), orderBy: desc(schema.pageMetrics.createdAt), limit: 60 });
  const ignoreRules = await db.query.ignoreRules.findMany({ where: eq(schema.ignoreRules.siteId, site.id) });
  return { site, client: client!, runs, latest, findings, metrics, ignoreRules };
}

export async function runDetail(runId: string) {
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) return null;
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, run.siteId) });
  const findings = await db.query.findings.findMany({ where: eq(schema.findings.runId, run.id) });
  const states = findings.length
    ? await db.query.findingStates.findMany({ where: eq(schema.findingStates.siteId, run.siteId) })
    : [];
  const stateByFp = new Map(states.map((s) => [s.fingerprint, s]));
  const metrics = await db.query.pageMetrics.findMany({ where: eq(schema.pageMetrics.runId, run.id) });
  return { run, site: site!, findings, stateByFp, metrics };
}

export async function clientDetail(clientId: string) {
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) return null;
  const sites = await db.query.sites.findMany({ where: eq(schema.sites.clientId, client.id), orderBy: schema.sites.name });
  const connections = await db.query.webflowConnections.findMany({ where: eq(schema.webflowConnections.clientId, client.id) });
  const cards: SiteCard[] = [];
  for (const s of sites) cards.push(await siteCard(s));
  return { client, sites: cards, connections };
}
