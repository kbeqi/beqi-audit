import type { CrawlResult, LinkCheckResult } from "./types";

const UA = "BeqiAuditBot/1.0 (+https://beqi.co; link check)";
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 8;
const MAX_HOPS = 5;

export interface LinkCheckOptions {
  maxUrls: number;
  // Internal pages already fetched by the crawler don't need another request.
  knownPages: Map<string, number>;
}

export async function checkLinks(crawl: CrawlResult, opts: LinkCheckOptions): Promise<LinkCheckResult[]> {
  const referrers = new Map<string, Set<string>>();
  for (const page of crawl.pages) {
    for (const link of page.links) {
      const key = canonicalKey(link.href);
      if (!key) continue;
      if (!referrers.has(key)) referrers.set(key, new Set());
      referrers.get(key)!.add(page.path);
    }
  }

  // Internal first (they matter more), then external, capped.
  const all = [...referrers.keys()];
  const internal = all.filter((u) => safeHost(u) === crawl.host);
  const external = all.filter((u) => safeHost(u) !== crawl.host);
  const targets = [...internal, ...external].slice(0, opts.maxUrls);

  const results: LinkCheckResult[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const checked = await Promise.all(
      batch.map(async (url) => {
        const isInternal = safeHost(url) === crawl.host;
        const known = opts.knownPages.get(url);
        const base = { url, internal: isInternal, referrers: [...(referrers.get(url) ?? [])] };
        if (known !== undefined) return { ...base, status: known, finalUrl: url, hops: 0 };
        return { ...base, ...(await probe(url)) };
      }),
    );
    results.push(...checked);
  }
  return results;
}

async function probe(url: string): Promise<{ status: number | null; finalUrl: string | null; hops: number; error?: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    try {
      let res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        headers: { "user-agent": UA, accept: "*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Many hosts reject HEAD; retry with GET.
      if (res.status === 405 || res.status === 403 || res.status === 501) {
        res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          headers: { "user-agent": UA, accept: "text/html,*/*" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        await res.body?.cancel();
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { status: res.status, finalUrl: current, hops: hop };
        current = new URL(loc, current).toString();
        continue;
      }
      return { status: res.status, finalUrl: current, hops: hop };
    } catch (e) {
      return { status: null, finalUrl: current, hops: hop, error: (e as Error).message };
    }
  }
  return { status: null, finalUrl: current, hops: MAX_HOPS + 1, error: "too many redirects" };
}

function canonicalKey(href: string): string | null {
  try {
    const u = new URL(href);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}
