#!/usr/bin/env node
// UX / UI checks for the running app. For every page, at desktop and phone
// widths, it verifies the things that make a screen usable and tell people
// where they are:
//   - exactly one <h1>; a document title that names the page, not just the app
//   - a breadcrumb on every page below the top level
//   - exactly one active item in the primary nav, and in the client tabs
//   - every form control has a label; every button and link has a name
//   - no axe-core violations of impact "serious" or "critical"
//   - no horizontal page overflow
// Usage: node scripts/ux-check.mjs [baseUrl] [loginToken]
//   loginToken: a raw login_tokens token (64 hex chars) when sign-in is enforced.
// Requires playwright (installed globally in CI/this environment) and axe-core.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const TOKEN = process.argv[3] ?? "";
const PAGES = [
  { path: "/", top: true },
  { path: "/clients", top: true },
  { path: "/clients/new" },
  { path: "/clients/c_goldie", tabs: true },
  { path: "/clients/c_goldie/audits", tabs: true },
  { path: "/clients/c_goldie/fixes", tabs: true },
  { path: "/clients/c_goldie/sites", tabs: true },
  { path: "/clients/c_goldie/settings", tabs: true },
  { path: "/sites/s_goldie" },
  { path: "/runs/r_g3" },
  { path: "/runs/r_g4" },
  { path: "/runs/r_gs1" },
  { path: "/fixes/p2" },
  { path: "/team", top: true },
  { path: "/share/sharetokenux000001", public: true },
  { path: "/login", public: true, signedOut: true },
];

const problems = [];
const notes = [];
const browser = await chromium.launch();

async function audit(page, p, width) {
  const where = `${p.path} @${width}`;
  const res = await page.goto(BASE + p.path, { waitUntil: "networkidle" });
  if (!res || res.status() !== 200) {
    problems.push(`${where}: HTTP ${res?.status()}`);
    return;
  }
  const info = await page.evaluate(() => {
    const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length || el.classList.contains("sr-only")));
    const h1s = [...document.querySelectorAll("h1")].filter(vis);
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const tabs = document.querySelector('nav[aria-label="Client sections"]');
    const unlabeled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => {
      if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
      return !el.closest("label");
    });
    const unnamedButtons = [...document.querySelectorAll("button, a[href]")].filter((el) => !(el.textContent || "").trim() && !el.getAttribute("aria-label") && !el.getAttribute("title") && !el.querySelector("img[alt]"));
    return {
      title: document.title,
      h1: h1s.map((h) => h.textContent.trim()),
      crumbs: !!document.querySelector('nav[aria-label="Breadcrumb"]'),
      navActive: nav ? nav.querySelectorAll('[aria-current="page"]').length : null,
      tabsActive: tabs ? tabs.querySelectorAll('[aria-current="page"]').length : null,
      unlabeled: unlabeled.map((el) => el.name || el.id || el.tagName),
      unnamed: unnamedButtons.length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollW: document.documentElement.scrollWidth,
    };
  });
  if (info.h1.length !== 1) problems.push(`${where}: expected one h1, found ${info.h1.length} (${info.h1.join(" | ")})`);
  if (!info.title || /^Beqi Audit$/.test(info.title)) problems.push(`${where}: title "${info.title}" does not name the page`);
  if (!p.top && !p.public && !info.crumbs) problems.push(`${where}: no breadcrumb`);
  if (!p.public && info.navActive !== 1) problems.push(`${where}: primary nav has ${info.navActive} active items (want 1)`);
  if (p.tabs && info.tabsActive !== 1) problems.push(`${where}: client tabs have ${info.tabsActive} active items (want 1)`);
  if (info.unlabeled.length) problems.push(`${where}: unlabeled controls: ${info.unlabeled.join(", ")}`);
  if (info.unnamed) problems.push(`${where}: ${info.unnamed} button(s)/link(s) without an accessible name`);
  if (info.overflow) problems.push(`${where}: horizontal overflow (${info.scrollW}px > ${width}px)`);

  await page.addScriptTag({ content: axeSource });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ["violations"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target?.[0] ?? ""}`);
  });
  for (const v of axe) problems.push(`${where}: axe ${v}`);
  notes.push(`${where}: ok · title "${info.title}" · h1 "${info.h1[0] ?? ""}"`);
}

// Sign in once (tokens are single-use) and reuse the session cookie per width.
let sessionCookies = [];
if (TOKEN) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/api/auth/callback?token=${TOKEN}&next=/`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    console.log("Could not sign in with the supplied token; is it unused and unexpired?");
    process.exit(2);
  }
  sessionCookies = await ctx.cookies();
  await ctx.close();
}

for (const width of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, isMobile: width < 600 });
  if (sessionCookies.length) await ctx.addCookies(sessionCookies);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`console error @${width}: ${e.message}`));
  for (const p of PAGES.filter((x) => !x.signedOut)) await audit(page, p, width);
  await ctx.close();
  // Signed-out pages in a fresh context.
  const anon = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  for (const p of PAGES.filter((x) => x.signedOut)) await audit(anon, p, width);
  await anon.close();
}
await browser.close();

const uniq = (a) => [...new Set(a)];
console.log(`Checked ${PAGES.length} pages at 2 widths against ${BASE}`);
for (const n of notes.filter((_, i) => i < PAGES.length)) console.log("  " + n);
if (problems.length) {
  console.log("");
  for (const p of uniq(problems)) console.log("  FAIL  " + p);
  console.log(`\n${uniq(problems).length} problem(s).`);
  process.exit(1);
}
console.log("\nAll UX checks pass.");
