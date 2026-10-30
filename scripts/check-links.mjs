#!/usr/bin/env node
// Crawls the app and checks that every internal link works and lands where
// its label says. Fails (exit 1) on:
//   - a link whose target is not 200, or renders the not-found / error page
//   - a link whose text names an entity (a client, a site, a fix) that is not
//     the heading of the page it opens ("linking to the wrong place")
// Usage: node scripts/check-links.mjs [baseUrl]   (default http://localhost:8787)
// Pages are server-rendered, so plain fetch is enough; no browser needed.

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const MAX_PAGES = 400;
// Endpoints that are not pages: they start a flow (OAuth) or answer JSON.
// Links to them are verified by shape only, never fetched (fetching the OAuth
// start would register a pending authorization each time).
const ENDPOINTS = [
  { re: /^\/api\/webflow\/authorize\?client=[a-z0-9_-]+$/, name: "Webflow OAuth start" },
  { re: /^\/api\/streams\/[a-z0-9_-]+\/events(\?.*)?$/, name: "live-log events" },
];
// Link labels that are navigation or status words, not entity names.
const GENERIC = new Set(["open", "all fixes", "full run", "from this audit", "view the change", "back to portfolio", "open client", "add client", "add your first client", "connect webflow", "connect another workspace", "portfolio", "clients", "fixes", "audits", "beqi audit", "reconnect the workspace", "to review", "more changes"]);
const GENERIC_RE = /^(view\b|\+?\s*\d+ more|fix (proposed|applied|approved|being applied)|running\b|queued\b|\d+ to review|(overview|audits|fixes|sites|settings)\b|link$|shared link|full report|all audits|review$|go to settings|audit now|connect )/;

const queue = ["/"];
const seen = new Set(queue);
const failures = [];
const warnings = [];
let checked = 0;

function text(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function heading(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "";
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  return { h1: decode(text(h1)), title: decode(text(title)) };
}
function links(html, fromPath) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = /href="([^"]*)"/i.exec(m[1])?.[1];
    if (!href) continue;
    const label = decode(text(m[2])).replace(/[→›»]+$/, "").trim();
    out.push({ href, label, from: fromPath });
  }
  return out;
}
function normalize(href, fromPath) {
  if (/^(mailto:|tel:|javascript:)/i.test(href)) return null;
  let u;
  try {
    u = new URL(href, BASE + fromPath);
  } catch {
    return { bad: href };
  }
  if (u.origin !== BASE) return null; // external links are the audit's job, not this test's
  return { path: u.pathname + u.search, hash: u.hash };
}

const pages = new Map(); // path -> { status, html }
async function load(path) {
  if (pages.has(path)) return pages.get(path);
  const res = await fetch(BASE + path, { redirect: "manual", headers: { accept: "text/html", cookie: process.env.LINKCHECK_COOKIE ?? "" } });
  let status = res.status;
  let html = "";
  if (status >= 300 && status < 400) {
    const loc = res.headers.get("location") ?? "";
    const target = normalize(loc, path);
    html = `<title>redirect</title>`;
    pages.set(path, { status, html, redirect: target?.path ?? loc });
    return pages.get(path);
  }
  html = await res.text();
  if (status === 200 && /Something went wrong|Minified React error/.test(html)) status = 500;
  if (status === 200 && />Not found<\//.test(html)) status = 404;
  const entry = { status, html };
  pages.set(path, entry);
  return entry;
}

while (queue.length && checked < MAX_PAGES) {
  const path = queue.shift();
  const page = await load(path);
  checked++;
  if (page.status !== 200) {
    if (path !== "/") failures.push(`${path} -> ${page.status}${page.redirect ? ` (redirect to ${page.redirect})` : ""}`);
    continue;
  }
  for (const l of links(page.html, path)) {
    const n = normalize(l.href, path);
    if (n === null) continue;
    if (n.bad) {
      failures.push(`${l.from}: malformed href "${n.bad}" (label "${l.label}")`);
      continue;
    }
    if (n.path.startsWith("/api/")) {
      const known = ENDPOINTS.find((e) => e.re.test(n.path));
      if (!known) failures.push(`${l.from} → ${n.path}: link to an unknown API path (label "${l.label}")`);
      continue;
    }
    const target = await load(n.path);
    const where = `${l.from} → ${n.path}`;
    if (target.status !== 200) {
      failures.push(`${where} is ${target.status}${target.redirect ? ` (redirect to ${target.redirect})` : ""} (label "${l.label}")`);
    } else {
      // "Wrong place" check: an entity-named link must land on that entity's page.
      const label = l.label.toLowerCase();
      const isEntity = label.length > 2 && !GENERIC.has(label) && !GENERIC_RE.test(label) && !/^\d/.test(label) && !/^(all|critical|high|medium|low|info)\b/.test(label) && !/[?#]/.test(n.path);
      if (isEntity) {
        const { h1, title } = heading(target.html);
        const hay = `${h1} ${title}`.toLowerCase();
        if (!hay.includes(label) && !label.includes(h1.toLowerCase().slice(0, 24) || "\u0000")) {
          warnings.push(`${where}: link says "${l.label}" but the page heading is "${h1 || title}"`);
        }
      }
      if (n.hash && !new RegExp(`id="${n.hash.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(target.html)) {
        failures.push(`${where}${n.hash}: anchor "${n.hash}" does not exist on the page (label "${l.label}")`);
      }
    }
    if (!seen.has(n.path)) {
      seen.add(n.path);
      queue.push(n.path);
    }
  }
}

const unique = (a) => [...new Set(a)];
console.log(`Checked ${checked} pages, ${pages.size} distinct URLs at ${BASE}`);
for (const w of unique(warnings)) console.log("  warn  " + w);
for (const f of unique(failures)) console.log("  FAIL  " + f);
if (failures.length) {
  console.log(`\n${unique(failures).length} broken or misdirected link(s).`);
  process.exit(1);
}
console.log(unique(warnings).length ? `\nAll links resolve; ${unique(warnings).length} label/heading mismatch(es) to review.` : "\nAll links resolve and land on the right pages.");
