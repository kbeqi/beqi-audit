// Thin clients for the Google APIs the app reads: Search Console (sites and
// search analytics) and GA4 (property list and the Data API). Every call
// takes a fresh access token from oauth.ts.

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface Ga4Property {
  property: string; // "properties/123456"
  displayName: string;
  account: string;
}

export interface DailyPageRow {
  date: string; // YYYY-MM-DD
  page: string; // path, "*" for the site total
  clicks: number;
  impressions: number;
  position: number | null;
  sessions: number;
  keyEvents: number;
}

// Referrers that are AI assistants. Matched against GA4's sessionSource
// (a host, usually) as a partial regexp; kept short so it stays readable.
export const AI_SOURCE_REGEXP = "chatgpt|openai|perplexity|claude\\.ai|anthropic|gemini\\.google|bard\\.google|copilot\\.microsoft|you\\.com|phind|meta\\.ai|mistral\\.ai|deepseek";

async function google<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Google API ${res.status} on ${new URL(url).pathname}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function listGscSites(token: string): Promise<GscSite[]> {
  const body = await google<{ siteEntry?: GscSite[] }>(token, "https://www.googleapis.com/webmasters/v3/sites");
  return (body.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export async function listGa4Properties(token: string): Promise<Ga4Property[]> {
  const out: Ga4Property[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
    u.searchParams.set("pageSize", "200");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const body = await google<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[]; nextPageToken?: string }>(token, u.toString());
    for (const a of body.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ property: p.property, displayName: p.displayName, account: a.displayName });
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname || "/").replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

// Clicks, impressions and position per day and page, plus a "*" total row
// per day. Search Console returns at most 25 000 rows per call, plenty for a
// marketing site over a few weeks.
export async function gscDaily(token: string, property: string, start: string, end: string): Promise<DailyPageRow[]> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const body = await google<{ rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }>(token, url, {
    method: "POST",
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["date", "page"], rowLimit: 25000, dataState: "all" }),
  });
  const rows: DailyPageRow[] = [];
  const totals = new Map<string, { clicks: number; impressions: number; posW: number }>();
  for (const r of body.rows ?? []) {
    const [date, page] = r.keys;
    rows.push({ date, page: pathOf(page), clicks: r.clicks, impressions: r.impressions, position: r.position, sessions: 0, keyEvents: 0 });
    const t = totals.get(date) ?? { clicks: 0, impressions: 0, posW: 0 };
    t.clicks += r.clicks;
    t.impressions += r.impressions;
    t.posW += r.position * r.impressions;
    totals.set(date, t);
  }
  for (const [date, t] of totals) rows.push({ date, page: "*", clicks: t.clicks, impressions: t.impressions, position: t.impressions ? t.posW / t.impressions : null, sessions: 0, keyEvents: 0 });
  return rows;
}

interface Ga4Report {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
}

function ga4Date(v: string): string {
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

// Sessions and key events per day and landing page (+ "*" totals).
export async function ga4Daily(token: string, property: string, start: string, end: string): Promise<DailyPageRow[]> {
  const body = await google<Ga4Report>(token, `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: "POST",
    body: JSON.stringify({
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "date" }, { name: "landingPage" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      limit: 25000,
    }),
  });
  const rows: DailyPageRow[] = [];
  const totals = new Map<string, { sessions: number; keyEvents: number }>();
  for (const r of body.rows ?? []) {
    const date = ga4Date(r.dimensionValues[0].value);
    const page = pathOf(`https://x${r.dimensionValues[1].value.startsWith("/") ? "" : "/"}${r.dimensionValues[1].value}`);
    const sessions = Number(r.metricValues[0].value) || 0;
    const keyEvents = Number(r.metricValues[1].value) || 0;
    rows.push({ date, page, clicks: 0, impressions: 0, position: null, sessions, keyEvents });
    const t = totals.get(date) ?? { sessions: 0, keyEvents: 0 };
    t.sessions += sessions;
    t.keyEvents += keyEvents;
    totals.set(date, t);
  }
  for (const [date, t] of totals) rows.push({ date, page: "*", clicks: 0, impressions: 0, position: null, sessions: t.sessions, keyEvents: t.keyEvents });
  return rows;
}

// Sessions referred by AI assistants, per day and landing page (+ totals).
export async function ga4AiDaily(token: string, property: string, start: string, end: string): Promise<DailyPageRow[]> {
  const body = await google<Ga4Report>(token, `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: "POST",
    body: JSON.stringify({
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "date" }, { name: "landingPage" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      dimensionFilter: { filter: { fieldName: "sessionSource", stringFilter: { matchType: "PARTIAL_REGEXP", value: AI_SOURCE_REGEXP, caseSensitive: false } } },
      limit: 25000,
    }),
  });
  const rows: DailyPageRow[] = [];
  const totals = new Map<string, { sessions: number; keyEvents: number }>();
  for (const r of body.rows ?? []) {
    const date = ga4Date(r.dimensionValues[0].value);
    const page = pathOf(`https://x${r.dimensionValues[1].value.startsWith("/") ? "" : "/"}${r.dimensionValues[1].value}`);
    const sessions = Number(r.metricValues[0].value) || 0;
    const keyEvents = Number(r.metricValues[1].value) || 0;
    rows.push({ date, page, clicks: 0, impressions: 0, position: null, sessions, keyEvents });
    const t = totals.get(date) ?? { sessions: 0, keyEvents: 0 };
    t.sessions += sessions;
    t.keyEvents += keyEvents;
    totals.set(date, t);
  }
  for (const [date, t] of totals) rows.push({ date, page: "*", clicks: 0, impressions: 0, position: null, sessions: t.sessions, keyEvents: t.keyEvents });
  return rows;
}
