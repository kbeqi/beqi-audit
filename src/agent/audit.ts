// The audit agent: one Claude conversation with Webflow's MCP server and
// web_fetch attached, streamed so the activity log fills in as it works, then a
// tool-free call that turns the written report into validated JSON.

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { RunUsage, Site } from "@/db/schema";
import type { WebflowConnection } from "@/db/schema";
import { addUsage, BETAS, emptyUsage, getAnthropic, MODEL } from "./anthropic";
import type { EventSink } from "./events";
import { AGENT_HARNESS, AUDIT_SYSTEM_PROMPT, STRUCTURE_SYSTEM_PROMPT, auditTaskPrompt, type PreviousFinding } from "./prompts";
import { AuditReportSchema, type AuditReport } from "./schemas";
import { AUDIT_TOOLS, actionsOfToolCall, describeToolCall, isWriteAction, webflowMcpServer, webflowToolset } from "./webflow-mcp";

const MAX_CONTINUATIONS = 12;
// The Workflow step allows 30 minutes; stop continuing before that so the run
// fails with a clear message instead of being killed.
const AGENT_DEADLINE_MS = 24 * 60 * 1000;
// A report longer than this is trimmed to its JSON block before structuring.
const REPORT_TEXT_SOFT_LIMIT = 60_000;
const WEB_FETCH_MAX_USES = 60;
// Each fetched page stays in the conversation for every later turn, so the
// per-fetch cap is the main cost lever. 12K tokens covers a marketing page's
// head, headings, links and copy; what is cut is mostly markup.
const WEB_FETCH_MAX_CONTENT_TOKENS = 12_000;
const PAGE_BUDGET_CAP = 40;

export type AgentEnv = Pick<CloudflareEnv, "ANTHROPIC_API_KEY" | "WEBFLOW_MCP_URL">;

export interface AuditAgentInput {
  env: AgentEnv;
  runId: string;
  site: Site;
  clientName: string;
  connection: WebflowConnection;
  previous: PreviousFinding[];
  // Text block of measured Core Web Vitals (from PageSpeed Insights), or null.
  psiSummary: string | null;
  emit: EventSink;
}

export interface AuditAgentOutput {
  reportText: string;
  usage: RunUsage;
  // Full conversation, for the transcript store.
  messages: Anthropic.Beta.BetaMessageParam[];
  writeAttempts: string[];
  // Hosts whose fetches were refused with url_not_allowed (robots / bot protection).
  blockedHosts: string[];
}

export async function runAuditAgent(input: AuditAgentInput): Promise<AuditAgentOutput> {
  const { env, runId, site, clientName, connection, previous, psiSummary, emit } = input;
  const client = getAnthropic(env);
  const started = Date.now();
  const usage = emptyUsage();
  const agentId = `${MODEL}|${AGENT_HARNESS}|${runId.slice(-6)}`;
  const host = new URL(site.baseUrl).host;
  const pageBudget = Math.min(site.maxPages, PAGE_BUDGET_CAP);
  // The staging host is fetched once to check it is not indexable.
  const allowedDomains = [host];
  if (site.shortName && !host.endsWith(".webflow.io")) allowedDomains.push(`${site.shortName}.webflow.io`);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: auditTaskPrompt({ site, clientName, agentId, pageBudget, linkBudget: 40, previous, psiSummary }) },
  ];
  const writeAttempts: string[] = [];
  const blockedHosts = new Set<string>();
  // server_tool_use id -> url, so a fetch error can be attributed to its host.
  const fetchUrls = new Map<string, string>();
  let finalText = "";

  await emit("status", `Auditing ${site.name} with ${MODEL}`, { host, pageBudget });

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    if (Date.now() - started > AGENT_DEADLINE_MS) {
      throw new Error(`Audit ran out of time after ${Math.round((Date.now() - started) / 60000)} minutes; lower the site's page budget and run again`);
    }
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: AUDIT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      mcp_servers: [webflowMcpServer(connection, env)],
      tools: [
        webflowToolset(AUDIT_TOOLS),
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: WEB_FETCH_MAX_USES, allowed_domains: allowedDomains, max_content_tokens: WEB_FETCH_MAX_CONTENT_TOKENS },
      ],
      messages,
    });

    stream.on("contentBlock", (block) => {
      void logBlock(block, emit, usage, writeAttempts, blockedHosts, fetchUrls);
    });

    const message = await stream.finalMessage();
    addUsage(usage, message.usage);
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") {
      await emit("status", "Continuing (long tool sequence)");
      continue;
    }
    if (message.stop_reason === "refusal") {
      const why = message.stop_details?.type === "refusal" ? message.stop_details.explanation ?? message.stop_details.category ?? "" : "";
      throw new Error(`The model declined to continue the audit${why ? `: ${why}` : ""}`);
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error("Audit output was cut off (max_tokens); the site may be too large for one run");
    }
    finalText = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    break;
  }

  if (!finalText.trim()) throw new Error("The audit agent produced no report");
  if (writeAttempts.length) {
    throw new Error(`Audit aborted: the agent attempted write actions (${writeAttempts.slice(0, 5).join(", ")})`);
  }
  usage.durationMs = Date.now() - started;
  await emit("status", `Report written (${Math.round(finalText.length / 1000)}K characters)${blockedHosts.size ? `; live site blocked Claude's fetcher: ${[...blockedHosts].join(", ")}` : ""}`, {
    length: finalText.length,
    blockedHosts: [...blockedHosts],
  });
  return { reportText: finalText, usage, messages, writeAttempts, blockedHosts: [...blockedHosts] };
}

// Second pass, run as its own pipeline step: no tools, strict JSON schema.
// Cheap relative to the audit, and retried on its own if it fails.
export async function structureAuditReport(env: AgentEnv, reportText: string, usage: RunUsage, emit: EventSink): Promise<AuditReport> {
  const client = getAnthropic(env);
  await emit("status", "Structuring the report");
  let text = reportText;
  if (text.length > REPORT_TEXT_SOFT_LIMIT) {
    // Keep the JSON block (the source of truth) and the summary before it.
    const m = /```json\s*([\s\S]*?)```/i.exec(text);
    const json = m?.[1]?.trim();
    const summary = m ? text.slice(0, m.index).trim().slice(0, 8_000) : "";
    text = json ? `${summary}\n\n\`\`\`json\n${json}\n\`\`\`` : text.slice(0, REPORT_TEXT_SOFT_LIMIT);
    await emit("warning", `Report is long (${Math.round(reportText.length / 1000)}K characters); structuring from its JSON block only`);
  }
  // Streamed: a large JSON output takes minutes, and a non-streaming request
  // that long is cut off (HTTP 524) before the API answers.
  const message = await client.messages
    .stream(
      {
        model: MODEL,
        max_tokens: 48000,
        system: STRUCTURE_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(AuditReportSchema), effort: "medium" },
        messages: [{ role: "user", content: `Convert this audit report to the schema.\n\n${text}` }],
      },
      { timeout: 20 * 60 * 1000 },
    )
    .finalMessage();
  addUsage(usage, message.usage);
  if (message.stop_reason === "max_tokens") throw new Error("The audit report is too long to structure; lower the site's page budget and run again");
  const json = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Could not structure the audit report (invalid JSON)");
  }
  const result = AuditReportSchema.safeParse(raw);
  if (!result.success) throw new Error(`Could not structure the audit report: ${result.error.issues[0]?.message ?? "schema mismatch"}`);
  const report = result.data;
  await emit("done", `Report ready: ${report.findings.length} findings, ${report.proposals.length} proposed fixes`, {
    pagesReviewed: report.siteFacts.pagesReviewed,
    costUsd: usage.estimatedCostUsd,
  });
  return report;
}

// Mirrors each completed content block into the activity log and the write
// guard. Runs as blocks complete; the stream itself is unaffected.
async function logBlock(block: Anthropic.Beta.BetaContentBlock, emit: EventSink, usage: RunUsage, writeAttempts: string[], blockedHosts: Set<string>, fetchUrls: Map<string, string>): Promise<void> {
  switch (block.type) {
    case "mcp_tool_use": {
      usage.toolCalls += 1;
      const actions = actionsOfToolCall(block.input);
      const writes = actions.filter((a) => isWriteAction(block.name, a));
      if (writes.length) writeAttempts.push(`${block.name}:${writes.join("/")}`);
      await emit(writes.length ? "warning" : "tool_call", describeToolCall(block.name, block.input), {
        tool: block.name,
        actions,
        write: writes.length > 0,
      });
      return;
    }
    case "mcp_tool_result": {
      const text = typeof block.content === "string" ? block.content : block.content.map((c) => c.text).join("");
      if (block.is_error) await emit("warning", `Webflow tool error: ${text.slice(0, 200)}`, { toolUseId: block.tool_use_id });
      else await emit("tool_result", `${formatBytes(text.length)} returned`, { toolUseId: block.tool_use_id });
      return;
    }
    case "server_tool_use": {
      if (block.name === "web_fetch") {
        usage.webFetches += 1;
        const url = (block.input as { url?: string } | null)?.url;
        if (url) fetchUrls.set(block.id, url);
        await emit("fetch", `Fetching ${url ?? "page"}`, { url });
      }
      return;
    }
    case "web_fetch_tool_result": {
      const c = block.content as { type: string; url?: string; error_code?: string };
      if (c.type === "web_fetch_tool_result_error") {
        const url = c.url ?? fetchUrls.get(block.tool_use_id);
        if (c.error_code === "url_not_allowed" && url) {
          try {
            blockedHosts.add(new URL(url).host);
          } catch {
            /* unparsable url */
          }
        }
        await emit("warning", `Fetch failed: ${c.error_code ?? "error"}${c.error_code === "url_not_allowed" ? " (the site blocks Claude's fetcher)" : ""}`, { url });
      }
      return;
    }
    case "text": {
      const t = block.text.trim();
      if (t) await emit("text", t.slice(0, 400), { length: t.length });
      return;
    }
    default:
      return;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
