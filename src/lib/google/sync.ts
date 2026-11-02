// Nightly sync of Search Console and GA4 into page_stats, and the summaries
// the UI and the monthly report read from it. Nothing here calls Claude.

import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { dbFromEnv, schema, type Db } from "@/db";
import type { Site, StatsSource } from "@/db/schema";
import { newId } from "@/lib/id";
import { ga4AiDaily, ga4Daily, gscDaily, type DailyPageRow } from "./api";
import { googleConnectionForClient, type GoogleEnv } from "./oauth";

export type SyncEnv = GoogleEnv;

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number, from = new Date()): string {
  return day(new Date(from.getTime() - n * 86_400_000));
}

// Replaces the window [start, end] for one source with fresh rows. Search
// Console revises the last two or three days, so re-syncing a window is the
// only way to keep the series honest.
async function replaceWindow(db: Db, siteId: string, source: StatsSource, start: string, end: string, rows: DailyPageRow[]): Promise<number> {
  await db.delete(schema.pageStats).where(and(eq(schema.pageStats.siteId, siteId), eq(schema.pageStats.source, source), gte(schema.pageStats.date, start), lte(schema.pageStats.date, end)));
  const values = rows.map((r) => ({ id: newId(), siteId, source, date: r.date, page: r.page, clicks: r.clicks, impressions: r.impressions, position: r.position, sessions: r.sessions, keyEvents: r.keyEvents }));
  for (let i = 0; i < values.length; i += 50) await db.insert(schema.pageStats).values(values.slice(i, i + 50));
  return values.length;
}

export interface SyncResult {
  gsc: number | null;
  ga4: number | null;
  ai: number | null;
  errors: string[];
}

// Syncs one site. `days` is the window to (re)fetch: 35 nightly, 120 on the
// first sync so the hub has a baseline right away. Each source is independent:
// a GA4 error does not lose the Search Console rows.
export async function syncSiteStats(env: SyncEnv, site: Site, days: number): Promise<SyncResult> {
  const db = dbFromEnv(env);
  const out: SyncResult = { gsc: null, ga4: null, ai: null, errors: [] };
  if (!site.gscProperty && !site.ga4Property) return out;
  const connection = await googleConnectionForClient(env, site.clientId);
  if (!connection) {
    out.errors.push("No active Google connection for this client.");
    return out;
  }
  // Search Console data lags about two days; GA4 about one.
  const end = daysAgo(1);
  const start = daysAgo(days);
  if (site.gscProperty) {
    try {
      const rows = await gscDaily(connection.accessToken, site.gscProperty, start, end);
      out.gsc = await replaceWindow(db, site.id, "gsc", start, end, rows);
    } catch (e) {
      out.errors.push(`Search Console: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  }
  if (site.ga4Property) {
    try {
      const rows = await ga4Daily(connection.accessToken, site.ga4Property, start, end);
      out.ga4 = await replaceWindow(db, site.id, "ga4", start, end, rows);
    } catch (e) {
      out.errors.push(`GA4: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
    try {
      const rows = await ga4AiDaily(connection.accessToken, site.ga4Property, start, end);
      out.ai = await replaceWindow(db, site.id, "ga4_ai", start, end, rows);
    } catch (e) {
      out.errors.push(`GA4 (AI referrals): ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  }
  await db.insert(schema.auditLog).values({
    id: newId(),
    siteId: site.id,
    actor: "system",
    action: out.errors.length ? "google.sync_failed" : "google.synced",
    detail: { days, gsc: out.gsc, ga4: out.ga4, ai: out.ai, errors: out.errors },
  });
  return out;
}

// Every linked site, once a day (guarded by sites.stats_synced_for). The
// first sync of a site pulls 120 days so there is a "before" to compare with.
export async function syncAllStats(env: SyncEnv, now: Date): Promise<{ synced: number; failed: number }> {
  const db = dbFromEnv(env);
  const today = day(now);
  const sites = await db.query.sites.findMany();
  let synced = 0;
  let failed = 0;
  for (const site of sites) {
    if (!site.gscProperty && !site.ga4Property) continue;
    if (site.statsSyncedFor === today) continue;
    await db.update(schema.sites).set({ statsSyncedFor: today }).where(eq(schema.sites.id, site.id));
    const r = await syncSiteStats(env, site, site.statsSyncedFor ? 35 : 120);
    if (r.errors.length) failed++;
    else synced++;
  }
  return { synced, failed };
}

// ---- summaries ---------------------------------------------------------------

export interface WindowTotals {
  clicks: number;
  impressions: number;
  position: number | null;
  sessions: number;
  keyEvents: number;
  aiSessions: number;
  aiKeyEvents: number;
  days: number;
}

export interface PageTotals {
  page: string;
  clicks: number;
  impressions: number;
  position: number | null;
  sessions: number;
  keyEvents: number;
  aiSessions: number;
}

export interface StatsSummary {
  // Whether anything has been synced at all; when false the UI explains setup.
  hasData: boolean;
  lastDate: string | null;
  current: WindowTotals;
  previous: WindowTotals;
  // Per-day site totals, oldest first, for the trend line (current window).
  series: { date: string; clicks: number; sessions: number; aiSessions: number }[];
  topPages: PageTotals[];
}

const emptyTotals = (days: number): WindowTotals => ({ clicks: 0, impressions: 0, position: null, sessions: 0, keyEvents: 0, aiSessions: 0, aiKeyEvents: 0, days });

function sum(rows: { source: StatsSource; page: string; clicks: number; impressions: number; position: number | null; sessions: number; keyEvents: number }[], days: number): WindowTotals {
  const t = emptyTotals(days);
  let posW = 0;
  for (const r of rows) {
    if (r.page !== "*") continue;
    if (r.source === "gsc") {
      t.clicks += r.clicks;
      t.impressions += r.impressions;
      if (r.position != null) posW += r.position * r.impressions;
    } else if (r.source === "ga4") {
      t.sessions += r.sessions;
      t.keyEvents += r.keyEvents;
    } else {
      t.aiSessions += r.sessions;
      t.aiKeyEvents += r.keyEvents;
    }
  }
  t.position = t.impressions ? Math.round((posW / t.impressions) * 10) / 10 : null;
  return t;
}

// The last `days` days against the `days` before them.
export async function statsSummary(db: Db, siteId: string, days = 28, until = new Date()): Promise<StatsSummary> {
  const end = daysAgo(1, until);
  const start = daysAgo(days, until);
  const prevEnd = daysAgo(days + 1, until);
  const prevStart = daysAgo(days * 2, until);
  const rows = await db.query.pageStats.findMany({ where: and(eq(schema.pageStats.siteId, siteId), gte(schema.pageStats.date, prevStart), lte(schema.pageStats.date, end)) });
  const anyRow = rows.length ? rows : await db.query.pageStats.findMany({ where: eq(schema.pageStats.siteId, siteId), limit: 1 });
  const latest = await db.query.pageStats.findFirst({ where: eq(schema.pageStats.siteId, siteId), orderBy: desc(schema.pageStats.date), columns: { date: true } });
  const cur = rows.filter((r) => r.date >= start);
  const prev = rows.filter((r) => r.date <= prevEnd);

  const byDay = new Map<string, { clicks: number; sessions: number; aiSessions: number }>();
  for (const r of cur) {
    if (r.page !== "*") continue;
    const d = byDay.get(r.date) ?? { clicks: 0, sessions: 0, aiSessions: 0 };
    if (r.source === "gsc") d.clicks += r.clicks;
    else if (r.source === "ga4") d.sessions += r.sessions;
    else d.aiSessions += r.sessions;
    byDay.set(r.date, d);
  }
  const pages = new Map<string, PageTotals & { posW: number }>();
  for (const r of cur) {
    if (r.page === "*") continue;
    const p = pages.get(r.page) ?? { page: r.page, clicks: 0, impressions: 0, position: null, sessions: 0, keyEvents: 0, aiSessions: 0, posW: 0 };
    if (r.source === "gsc") {
      p.clicks += r.clicks;
      p.impressions += r.impressions;
      if (r.position != null) p.posW += r.position * r.impressions;
    } else if (r.source === "ga4") {
      p.sessions += r.sessions;
      p.keyEvents += r.keyEvents;
    } else p.aiSessions += r.sessions;
    pages.set(r.page, p);
  }
  const topPages = [...pages.values()]
    .map((p) => ({ page: p.page, clicks: p.clicks, impressions: p.impressions, position: p.impressions ? Math.round((p.posW / p.impressions) * 10) / 10 : null, sessions: p.sessions, keyEvents: p.keyEvents, aiSessions: p.aiSessions }))
    .sort((a, b) => b.clicks + b.sessions - (a.clicks + a.sessions))
    .slice(0, 12);

  return {
    hasData: anyRow.length > 0,
    lastDate: latest?.date ?? null,
    current: sum(cur, days),
    previous: sum(prev, days),
    series: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    topPages,
  };
}

export interface FixedPageEffect {
  proposalId: string;
  title: string;
  page: string;
  appliedAt: string;
  before: { clicks: number; impressions: number; position: number | null; sessions: number };
  after: { clicks: number; impressions: number; position: number | null; sessions: number };
  // Days of data on each side; under 14 means "too early to tell".
  daysAfter: number;
}

// Pages with an applied fix at least 7 days old: the 28 days before the fix
// against the days since (capped at 28). Positions are impression-weighted.
export async function fixedPageEffects(db: Db, siteId: string, until = new Date()): Promise<FixedPageEffect[]> {
  const applied = await db.query.fixProposals.findMany({
    where: and(eq(schema.fixProposals.siteId, siteId), inArray(schema.fixProposals.status, ["applied", "resolved"])),
    orderBy: desc(schema.fixProposals.appliedAt),
    limit: 40,
  });
  const candidates = applied.filter((p) => p.appliedAt && p.target?.pagePath && until.getTime() - new Date(p.appliedAt).getTime() >= 7 * 86_400_000);
  if (candidates.length === 0) return [];
  const earliest = candidates.reduce((a, p) => (p.appliedAt! < a ? p.appliedAt! : a), candidates[0].appliedAt!);
  const start = daysAgo(28, new Date(earliest));
  const pagesWanted = [...new Set(candidates.map((p) => p.target!.pagePath!.replace(/\/+$/, "") || "/"))];
  const rows = await db.query.pageStats.findMany({
    where: and(eq(schema.pageStats.siteId, siteId), inArray(schema.pageStats.source, ["gsc", "ga4"]), gte(schema.pageStats.date, start), inArray(schema.pageStats.page, pagesWanted.slice(0, 60))),
  });
  const out: FixedPageEffect[] = [];
  const seen = new Set<string>();
  for (const p of candidates) {
    const page = p.target!.pagePath!.replace(/\/+$/, "") || "/";
    if (seen.has(page)) continue; // one card per page: the most recent fix
    seen.add(page);
    const at = p.appliedAt!.slice(0, 10);
    const daysAfter = Math.min(28, Math.floor((until.getTime() - new Date(p.appliedAt!).getTime()) / 86_400_000) - 1);
    const beforeStart = daysAgo(28, new Date(p.appliedAt!));
    const afterEnd = daysAgo(1, until);
    const agg = (filter: (d: string) => boolean) => {
      const t = { clicks: 0, impressions: 0, position: null as number | null, sessions: 0 };
      let posW = 0;
      for (const r of rows) {
        if (r.page !== page || !filter(r.date)) continue;
        if (r.source === "gsc") {
          t.clicks += r.clicks;
          t.impressions += r.impressions;
          if (r.position != null) posW += r.position * r.impressions;
        } else t.sessions += r.sessions;
      }
      t.position = t.impressions ? Math.round((posW / t.impressions) * 10) / 10 : null;
      return t;
    };
    const before = agg((d) => d >= beforeStart && d < at);
    const after = agg((d) => d > at && d <= afterEnd);
    if (before.impressions + before.sessions + after.impressions + after.sessions === 0) continue;
    out.push({ proposalId: p.id, title: p.title ?? p.action, page, appliedAt: p.appliedAt!, before, after, daysAfter });
  }
  return out;
}

// Totals for a calendar window, for the monthly report.
export async function windowTotals(db: Db, siteId: string, start: string, end: string): Promise<WindowTotals | null> {
  const rows = await db.query.pageStats.findMany({ where: and(eq(schema.pageStats.siteId, siteId), eq(schema.pageStats.page, "*"), gte(schema.pageStats.date, start), lte(schema.pageStats.date, end)) });
  if (rows.length === 0) return null;
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;
  return sum(rows, days);
}
