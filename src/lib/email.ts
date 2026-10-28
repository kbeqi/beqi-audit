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
}): EmailMessage {
  const link = `${opts.appUrl}/runs/${opts.runId}`;
  const delta = opts.score != null && opts.previousScore != null ? opts.score - opts.previousScore : null;
  const deltaText = delta == null ? "" : delta === 0 ? " (unchanged)" : ` (${delta > 0 ? "+" : ""}${delta} vs last audit)`;
  const title = `${opts.siteName}: audit score ${opts.score ?? "–"}/100${deltaText}`;
  const countsText = `${opts.counts.critical} critical · ${opts.counts.high} high · ${opts.counts.medium} medium · ${opts.counts.low} low`;
  const hl = opts.highlights.slice(0, 6);
  const text = `Hi,\n\nThe audit of ${opts.siteName} (${opts.siteHost}) is done.\n\nScore: ${opts.score ?? "–"}/100${deltaText}\nFindings: ${countsText}\nProposed fixes awaiting review: ${opts.proposals}\n\n${hl.length ? "Highlights:\n" + hl.map((h) => `- ${h}`).join("\n") + "\n\n" : ""}${opts.summary ? opts.summary + "\n\n" : ""}Full report: ${link}\n\n— Beqi`;
  const html = layout(
    title,
    `<p style="line-height:1.5">The audit of <strong>${esc(opts.siteName)}</strong> (${esc(opts.siteHost)}) is done.</p>
     <table style="border-collapse:collapse;margin:8px 0 16px"><tr>
       <td style="padding:8px 16px 8px 0"><div style="font-size:12px;color:#6b6b66">Score</div><div style="font-size:28px;font-weight:600">${opts.score ?? "–"}<span style="font-size:14px;color:#6b6b66">/100${esc(deltaText)}</span></div></td>
       <td style="padding:8px 16px"><div style="font-size:12px;color:#6b6b66">Findings</div><div style="font-size:14px">${esc(countsText)}</div></td>
       <td style="padding:8px 0 8px 16px"><div style="font-size:12px;color:#6b6b66">Fixes to review</div><div style="font-size:14px">${opts.proposals}</div></td>
     </tr></table>
     ${hl.length ? `<div style="font-size:12px;color:#6b6b66;margin-bottom:6px">Highlights</div><ul style="margin:0 0 16px;padding-left:18px;line-height:1.5">${hl.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
     <p><a href="${esc(link)}" style="display:inline-block;background:#2a78d6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">See the full report</a></p>`,
    `Sent for ${esc(opts.clientName)}. Fixes are only applied after a Beqi team member approves them.`,
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
