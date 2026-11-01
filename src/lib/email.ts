// Outbound email through Resend's HTTP API. Nothing here is required for the
// app to work: without RESEND_API_KEY every send is recorded as skipped.

import { dbFromEnv, schema } from "@/db";
import { newId } from "@/lib/id";

export type EmailEnv = Pick<CloudflareEnv, "DB" | "RESEND_API_KEY" | "EMAIL_FROM" | "APP_URL">;

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export function parseRecipients(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

export function emailConfigured(env: Pick<CloudflareEnv, "RESEND_API_KEY" | "EMAIL_FROM">): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

// Sends and records the outcome in audit_log. Never throws: a failed email
// must not fail the audit that triggered it.
export async function sendEmail(env: EmailEnv, kind: string, msg: EmailMessage, siteId?: string | null): Promise<"sent" | "skipped" | "failed"> {
  const db = dbFromEnv(env);
  const record = (action: string, detail: Record<string, unknown>) =>
    db
      .insert(schema.auditLog)
      .values({ id: newId(), siteId: siteId ?? null, actor: "system", action, detail: { kind, to: msg.to, subject: msg.subject, ...detail } })
      .catch(() => {});
  if (msg.to.length === 0) return "skipped";
  if (!emailConfigured(env)) {
    await record("email.skipped", { reason: "RESEND_API_KEY or EMAIL_FROM not configured" });
    return "skipped";
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) {
      await record("email.failed", { status: res.status, body: (await res.text()).slice(0, 300) });
      return "failed";
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    await record("email.sent", { providerId: body.id ?? null });
    return "sent";
  } catch (e) {
    await record("email.failed", { error: String((e as Error).message ?? e).slice(0, 300) });
    return "failed";
  }
}

// ---- templates ---------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function layout(title: string, bodyHtml: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <div style="font-size:13px;color:#6b6b66;margin-bottom:16px">Beqi Audit</div>
  <div style="background:#fff;border:1px solid #e3e2dc;border-radius:12px;padding:24px">
    <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
    ${bodyHtml}
  </div>
  <div style="font-size:12px;color:#8a8984;margin-top:16px">${footer}</div>
</div></body></html>`;
}

export function reminderEmail(opts: { to: string[]; clientName: string; siteName: string; siteHost: string; when: Date; appUrl: string; siteId: string }): EmailMessage {
  const whenText = opts.when.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  const link = `${opts.appUrl}/sites/${opts.siteId}`;
  const title = `Scheduled audit of ${opts.siteName} on ${whenText}`;
  const text = `Hi,\n\nBeqi will run its scheduled audit of ${opts.siteName} (${opts.siteHost}) on ${whenText}.\n\nThe audit is read-only: it reviews the published site and its Webflow settings for SEO, AI discoverability, performance, links and hygiene. Nothing on the site is changed. You'll get the results by email when it finishes.\n\nSite in Beqi Audit: ${link}\n\n— Beqi`;
  const html = layout(
    title,
    `<p style="line-height:1.5">Beqi will run its scheduled audit of <strong>${esc(opts.siteName)}</strong> (${esc(opts.siteHost)}) on <strong>${esc(whenText)}</strong>.</p>
     <p style="line-height:1.5;color:#3f3f3b">The audit is read-only: it reviews the published site and its Webflow settings for SEO, AI discoverability, performance, links and hygiene. Nothing on the site is changed. You'll get the results by email when it finishes.</p>
     <p><a href="${esc(link)}" style="display:inline-block;background:#2a78d6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open in Beqi Audit</a></p>`,
    `Sent for ${esc(opts.clientName)}.`,
  );
  return { to: opts.to, subject: title, text, html };
}

export function resultsEmail(opts: {
  to: string[];
  clientName: string;
  siteName: string;
  siteHost: string;
  score: number | null;
  previousScore: number | null;
  counts: { critical: number; high: number; medium: number; low: number; info: number };
  highlights: string[];
  summary: string | null;
  proposals: number;
  appUrl: string;
  runId: string;
  // "publish": the audit ran because the site was published.
  trigger?: "schedule" | "manual" | "publish";
  newCriticalHigh?: number;
  aiVisibility?: { answers: number; mentioned: number; cited: number; inaccuracies: number } | null;
  pagesGone?: number;
}): EmailMessage {
  const link = `${opts.appUrl}/runs/${opts.runId}`;
  const delta = opts.score != null && opts.previousScore != null ? opts.score - opts.previousScore : null;
  const deltaText = delta == null ? "" : delta === 0 ? " (unchanged)" : ` (${delta > 0 ? "+" : ""}${delta} vs last audit)`;
  const afterPublish = opts.trigger === "publish";
  const title = `${opts.siteName}: ${afterPublish ? "post-publish check" : "audit"} score ${opts.score ?? "–"}/100${deltaText}`;
  const countsText = `${opts.counts.critical} critical · ${opts.counts.high} high · ${opts.counts.medium} medium · ${opts.counts.low} low`;
  const hl = opts.highlights.slice(0, 6);
  const intro = afterPublish ? `${opts.siteName} (${opts.siteHost}) was published, so we checked it again.` : `The audit of ${opts.siteName} (${opts.siteHost}) is done.`;
  const gone = opts.pagesGone ? ` ${opts.pagesGone} page${opts.pagesGone === 1 ? "" : "s"} that served at the last audit no longer load${opts.pagesGone === 1 ? "s" : ""}.` : "";
  const regression = afterPublish && opts.newCriticalHigh ? `${opts.newCriticalHigh} new critical or high finding(s) since the last audit; worth a look before the next change.${gone}` : afterPublish ? `Nothing new at critical or high severity since the last audit.${gone}` : gone ? gone.trim() : null;
  const ai = opts.aiVisibility && opts.aiVisibility.answers > 0 ? `AI assistants (sample of ${opts.aiVisibility.answers} answers): brand mentioned in ${opts.aiVisibility.mentioned}, site cited in ${opts.aiVisibility.cited}, ${opts.aiVisibility.inaccuracies} inaccurate claim(s).` : null;
  const text = `Hi,\n\n${intro}\n\nScore: ${opts.score ?? "–"}/100${deltaText}\nFindings: ${countsText}\nProposed fixes awaiting review: ${opts.proposals}\n${regression ? `${regression}\n` : ""}${ai ? `${ai}\n` : ""}\n${hl.length ? "Highlights:\n" + hl.map((h) => `- ${h}`).join("\n") + "\n\n" : ""}${opts.summary ? opts.summary + "\n\n" : ""}Full report: ${link}\n\n— Beqi`;
  const html = layout(
    title,
    `<p style="line-height:1.5">${esc(intro)}</p>
     ${regression ? `<p style="line-height:1.5;margin:0 0 8px">${esc(regression)}</p>` : ""}
     <table style="border-collapse:collapse;margin:8px 0 16px"><tr>
       <td style="padding:8px 16px 8px 0"><div style="font-size:12px;color:#6b6b66">Score</div><div style="font-size:28px;font-weight:600">${opts.score ?? "–"}<span style="font-size:14px;color:#6b6b66">/100${esc(deltaText)}</span></div></td>
       <td style="padding:8px 16px"><div style="font-size:12px;color:#6b6b66">Findings</div><div style="font-size:14px">${esc(countsText)}</div></td>
       <td style="padding:8px 0 8px 16px"><div style="font-size:12px;color:#6b6b66">Fixes to review</div><div style="font-size:14px">${opts.proposals}</div></td>
     </tr></table>
     ${ai ? `<p style="line-height:1.5;font-size:14px;margin:0 0 16px">${esc(ai)}</p>` : ""}
     ${hl.length ? `<div style="font-size:12px;color:#6b6b66;margin-bottom:6px">Highlights</div><ul style="margin:0 0 16px;padding-left:18px;line-height:1.5">${hl.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
     <p><a href="${esc(link)}" style="display:inline-block;background:#2a78d6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">See the full report</a></p>`,
    `Sent for ${esc(opts.clientName)}. Fixes are only applied after a Beqi team member approves them.`,
  );
  return { to: opts.to, subject: title, text, html };
}

// The monthly progress report: scores then and now, what was fixed, what is
// waiting, and who at Beqi to talk to.
export function monthlyEmail(opts: {
  to: string[];
  clientName: string;
  month: string;
  sites: {
    name: string;
    score: number | null;
    scoreBefore: number | null;
    openFindings: number | null;
    openBefore: number | null;
    vitals: { passing: number; pages: number } | null;
    ai: { now: number; of: number; before: number | null } | null;
    traffic?: { clicks: number; clicksBefore: number | null; sessions: number; sessionsBefore: number | null; aiSessions: number; aiSessionsBefore: number | null; keyEvents: number; position: number | null; positionBefore: number | null } | null;
  }[];
  fixesApplied: string[];
  resolved: number;
  waiting: number;
  audits: number;
  leadName: string | null;
  leadEmail: string | null;
  appUrl: string;
  clientId: string;
}): EmailMessage {
  const link = `${opts.appUrl}/clients/${opts.clientId}`;
  const title = `${opts.month}: your site care progress`;
  const d = (now: number | null, before: number | null) => (now == null || before == null ? "" : now - before === 0 ? " (unchanged)" : ` (${now - before > 0 ? "+" : ""}${now - before})`);
  const siteLines = opts.sites.map((s) => {
    const parts = [`Score ${s.score ?? "–"}/100${d(s.score, s.scoreBefore)}`];
    if (s.openFindings != null) parts.push(`${s.openFindings} open issue${s.openFindings === 1 ? "" : "s"}${s.openBefore != null ? ` (was ${s.openBefore})` : ""}`);
    if (s.vitals) parts.push(`Core Web Vitals pass on ${s.vitals.passing} of ${s.vitals.pages} key pages`);
    if (s.ai) parts.push(`AI assistants mention you in ${s.ai.now} of ${s.ai.of} sampled answers${s.ai.before != null ? ` (was ${s.ai.before})` : ""}`);
    if (s.traffic) {
      const pct = (now: number, before: number | null) => (before == null || before === 0 ? "" : ` (${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}% vs the month before)`);
      parts.push(`${s.traffic.clicks.toLocaleString("en-GB")} clicks from Google search${pct(s.traffic.clicks, s.traffic.clicksBefore)}${s.traffic.position != null ? `, average position ${s.traffic.position}${s.traffic.positionBefore != null ? ` (was ${s.traffic.positionBefore})` : ""}` : ""}`);
      if (s.traffic.sessions || s.traffic.sessionsBefore) parts.push(`${s.traffic.sessions.toLocaleString("en-GB")} visits${pct(s.traffic.sessions, s.traffic.sessionsBefore)}, ${s.traffic.aiSessions} from AI assistants${pct(s.traffic.aiSessions, s.traffic.aiSessionsBefore)}${s.traffic.keyEvents ? `, ${s.traffic.keyEvents} key events` : ""}`);
    }
    return { name: s.name, parts };
  });
  const fixes = opts.fixesApplied.slice(0, 8);
  const lead = opts.leadName ? `Your Beqi lead is ${opts.leadName}${opts.leadEmail ? ` (${opts.leadEmail})` : ""}; reply to this email with any question.` : "Reply to this email with any question.";
  const text = `Hi,\n\nHere is what happened on your site${opts.sites.length === 1 ? "" : "s"} in ${opts.month}.\n\n${siteLines.map((s) => `${s.name}\n${s.parts.map((p) => `  - ${p}`).join("\n")}`).join("\n\n")}\n\nAudits run: ${opts.audits}\nIssues resolved: ${opts.resolved}\nFixes applied: ${opts.fixesApplied.length}${fixes.length ? "\n" + fixes.map((f) => `  - ${f}`).join("\n") : ""}\n${opts.waiting ? `\n${opts.waiting} fix${opts.waiting === 1 ? "" : "es"} waiting for your approval: ${link}/fixes\n` : ""}\nYour hub: ${link}\n\n${lead}\n\n— Beqi`;
  const html = layout(
    title,
    `<p style="line-height:1.5">Here is what happened on your site${opts.sites.length === 1 ? "" : "s"} in <strong>${esc(opts.month)}</strong>.</p>
     ${siteLines.map((s) => `<div style="margin:12px 0"><div style="font-weight:600">${esc(s.name)}</div><ul style="margin:4px 0 0;padding-left:18px;line-height:1.5;color:#3f3f3b">${s.parts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`).join("")}
     <table style="border-collapse:collapse;margin:8px 0 16px"><tr>
       <td style="padding:8px 16px 8px 0"><div style="font-size:12px;color:#6b6b66">Audits</div><div style="font-size:22px;font-weight:600">${opts.audits}</div></td>
       <td style="padding:8px 16px"><div style="font-size:12px;color:#6b6b66">Issues resolved</div><div style="font-size:22px;font-weight:600">${opts.resolved}</div></td>
       <td style="padding:8px 16px"><div style="font-size:12px;color:#6b6b66">Fixes applied</div><div style="font-size:22px;font-weight:600">${opts.fixesApplied.length}</div></td>
       <td style="padding:8px 0 8px 16px"><div style="font-size:12px;color:#6b6b66">Waiting for you</div><div style="font-size:22px;font-weight:600">${opts.waiting}</div></td>
     </tr></table>
     ${fixes.length ? `<div style="font-size:12px;color:#6b6b66;margin-bottom:6px">Applied this month</div><ul style="margin:0 0 16px;padding-left:18px;line-height:1.5">${fixes.map((f) => `<li>${esc(f)}</li>`).join("")}${opts.fixesApplied.length > fixes.length ? `<li>and ${opts.fixesApplied.length - fixes.length} more</li>` : ""}</ul>` : ""}
     <p><a href="${esc(opts.waiting ? `${link}/fixes` : link)}" style="display:inline-block;background:#2a78d6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">${opts.waiting ? `Review ${opts.waiting} fix${opts.waiting === 1 ? "" : "es"}` : "Open your hub"}</a></p>
     <p style="font-size:13px;color:#6b6b66;line-height:1.5">${esc(lead)}</p>`,
    `Sent for ${esc(opts.clientName)}. Nothing on the site is changed without your approval.`,
  );
  return { to: opts.to, subject: title, text, html };
}

export function loginEmail(opts: { to: string; link: string; minutes: number }): EmailMessage {
  const title = "Sign in to Beqi Audit";
  return {
    to: [opts.to],
    subject: title,
    text: `Use this link to sign in to Beqi Audit. It works once and expires in ${opts.minutes} minutes.\n\n${opts.link}\n\nIf you didn't request it, ignore this email.`,
    html: layout(
      title,
      `<p style="line-height:1.5">Use the button to sign in. The link works once and expires in ${opts.minutes} minutes.</p>
       <p><a href="${esc(opts.link)}" style="display:inline-block;background:#2a78d6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Sign in</a></p>
       <p style="font-size:12px;color:#8a8984;word-break:break-all">Or copy this address: ${esc(opts.link)}</p>`,
      "If you didn't request this, ignore it; nobody can sign in without the link.",
    ),
  };
}

export function testEmail(opts: { to: string[]; clientName: string; appUrl: string }): EmailMessage {
  const title = `Test email from Beqi Audit for ${opts.clientName}`;
  return {
    to: opts.to,
    subject: title,
    text: `This address will receive audit reminders and results for ${opts.clientName}.\n\n${opts.appUrl}`,
    html: layout(title, `<p style="line-height:1.5">This address will receive audit reminders and results for <strong>${esc(opts.clientName)}</strong>.</p>`, `Sent from ${esc(opts.appUrl)}.`),
  };
}
