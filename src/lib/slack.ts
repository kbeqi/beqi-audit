// Posts to a client's Slack channel through an incoming webhook. Like email,
// nothing here is required: without a webhook URL the post is skipped, and a
// failure is recorded in audit_log rather than thrown.

import { dbFromEnv, schema } from "@/db";
import { newId } from "@/lib/id";

export type SlackEnv = Pick<CloudflareEnv, "DB">;

export interface SlackMessage {
  // Fallback for notifications and clients that don't render blocks.
  text: string;
  blocks?: unknown[];
}

export function slackConfigured(url: string | null | undefined): url is string {
  return !!url && /^https:\/\/hooks\.slack\.com\/services\//.test(url);
}

export async function postSlack(env: SlackEnv, webhookUrl: string | null | undefined, kind: string, msg: SlackMessage, siteId?: string | null): Promise<"sent" | "skipped" | "failed"> {
  const db = dbFromEnv(env);
  const record = (action: string, detail: Record<string, unknown>) =>
    db
      .insert(schema.auditLog)
      .values({ id: newId(), siteId: siteId ?? null, actor: "system", action, detail: { kind, ...detail } })
      .catch(() => {});
  if (!slackConfigured(webhookUrl)) return "skipped";
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: msg.text, blocks: msg.blocks }),
    });
    if (!res.ok) {
      await record("slack.failed", { status: res.status, body: (await res.text()).slice(0, 200) });
      return "failed";
    }
    await record("slack.sent", { text: msg.text.slice(0, 200) });
    return "sent";
  } catch (e) {
    await record("slack.failed", { error: String((e as Error).message ?? e).slice(0, 300) });
    return "failed";
  }
}

// ---- messages ----------------------------------------------------------------

const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

export function auditResultSlack(opts: {
  siteName: string;
  score: number | null;
  previousScore: number | null;
  counts: { critical: number; high: number; medium: number; low: number };
  proposals: number;
  highlights: string[];
  link: string;
  trigger: "schedule" | "manual" | "publish";
  newCriticalHigh: number;
}): SlackMessage {
  const delta = opts.score != null && opts.previousScore != null ? opts.score - opts.previousScore : null;
  const deltaText = delta == null ? "" : delta === 0 ? " (unchanged)" : ` (${delta > 0 ? "+" : ""}${delta})`;
  const head = opts.trigger === "publish" ? `Post-publish check of *${opts.siteName}*` : `Audit of *${opts.siteName}* finished`;
  const text = `${head}: score ${opts.score ?? "–"}/100${deltaText} · ${opts.counts.critical} critical, ${opts.counts.high} high · ${opts.proposals} fix${opts.proposals === 1 ? "" : "es"} to approve`;
  const lines = [
    section(`${head}\n*Score ${opts.score ?? "–"}/100*${deltaText} · ${opts.counts.critical} critical · ${opts.counts.high} high · ${opts.counts.medium} medium · ${opts.counts.low} low`),
    ...(opts.trigger === "publish" ? [context(opts.newCriticalHigh ? `:warning: ${opts.newCriticalHigh} new critical or high finding${opts.newCriticalHigh === 1 ? "" : "s"} since the last audit` : ":white_check_mark: nothing new at critical or high severity")] : []),
    ...(opts.highlights.length ? [section(opts.highlights.slice(0, 4).map((h) => `• ${h}`).join("\n"))] : []),
    section(opts.proposals ? `*${opts.proposals} fix${opts.proposals === 1 ? "" : "es"} waiting for approval.* <${opts.link}|Open the report>` : `<${opts.link}|Open the report>`),
  ];
  return { text, blocks: lines };
}

export function fixAppliedSlack(opts: { siteName: string; title: string; summary: string; needsPublish: boolean; by: string; link: string }): SlackMessage {
  const text = `Fix applied on ${opts.siteName}: ${opts.title}${opts.needsPublish ? " (publish the site to go live)" : ""}`;
  return {
    text,
    blocks: [
      section(`:white_check_mark: Fix applied on *${opts.siteName}*: ${opts.title}\n${opts.summary}`),
      context(`${opts.needsPublish ? "Publish the site in Webflow for it to go live. " : ""}Approved by ${opts.by} · <${opts.link}|Details>`),
    ],
  };
}

export function monthlySlack(opts: {
  clientName: string;
  month: string;
  sites: { name: string; score: number | null; scoreBefore: number | null }[];
  fixesApplied: number;
  resolved: number;
  waiting: number;
  aiMentioned: { now: number; of: number } | null;
  link: string;
}): SlackMessage {
  const sitesText = opts.sites
    .map((s) => {
      const d = s.score != null && s.scoreBefore != null ? s.score - s.scoreBefore : null;
      return `• *${s.name}*: ${s.score ?? "–"}/100${d == null ? "" : d === 0 ? " (unchanged)" : ` (${d > 0 ? "+" : ""}${d} this month)`}`;
    })
    .join("\n");
  const text = `${opts.month} progress for ${opts.clientName}: ${opts.fixesApplied} fixes applied, ${opts.resolved} issues resolved, ${opts.waiting} waiting for approval`;
  return {
    text,
    blocks: [
      section(`*${opts.month} progress · ${opts.clientName}*\n${sitesText}`),
      section(`${opts.fixesApplied} fix${opts.fixesApplied === 1 ? "" : "es"} applied · ${opts.resolved} issue${opts.resolved === 1 ? "" : "s"} resolved${opts.aiMentioned ? ` · AI assistants mention the brand in ${opts.aiMentioned.now} of ${opts.aiMentioned.of} sampled answers` : ""}`),
      section(opts.waiting ? `*${opts.waiting} fix${opts.waiting === 1 ? "" : "es"} waiting for approval.* <${opts.link}|Open the hub>` : `<${opts.link}|Open the hub>`),
    ],
  };
}
