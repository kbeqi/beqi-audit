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
  emit: EventSink;
}

export interface AuditAgentOutput {
  report: AuditReport;
  reportText: string;
  usage: RunUsage;
  // Full conversation, for the transcript store.
  messages: Anthropic.Beta.BetaMessageParam[];
  writeAttempts: string[];
}

export async function runAuditAgent(input: AuditAgentInput): Promise<AuditAgentOutput> {
  const { env, runId, site, clientName, connection, previous, emit } = input;
  const client = getAnthropic(env);
  const started = Date.now();
  const usage = emptyUsage();
  const agentId = `${MODEL}|${AGENT_HARNESS}|${runId.slice(-6)}`;
  const host = new URL(site.baseUrl).host;
  const pageBudget = Math.min(site.maxPages, PAGE_BUDGET_CAP);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: auditTaskPrompt({ site, clientName, agentId, pageBudget, linkBudget: 40, previous }) },
  ];
  const writeAttempts: string[] = [];
  let finalText = "";

  await emit("status", `Auditing ${site.name} with ${MODEL}`, { host, pageBudget });

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
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
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: WEB_FETCH_MAX_USES, allowed_domains: [host], max_content_tokens: WEB_FETCH_MAX_CONTENT_TOKENS },
      ],
      messages,
    });

    stream.on("contentBlock", (block) => {
      void logBlock(block, emit, usage, writeAttempts);
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

  await emit("status", "Structuring the report");
  const report = await structureReport(client, finalText, usage);
  usage.durationMs = Date.now() - started;
  await emit("done", `Report ready: ${report.findings.length} findings, ${report.proposals.length} proposed fixes`, {
    pagesReviewed: report.siteFacts.pagesReviewed,
    costUsd: usage.estimatedCostUsd,
  });
  return { report, reportText: finalText, usage, messages, writeAttempts };
}

// Second pass: no tools, strict JSON schema. Cheap relative to the audit.
async function structureReport(client: Anthropic, reportText: string, usage: RunUsage): Promise<AuditReport> {
  const parsed = await client.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    system: STRUCTURE_SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(AuditReportSchema), effort: "medium" },
    messages: [{ role: "user", content: `Convert this audit report to the schema.\n\n${reportText}` }],
  });
  addUsage(usage, parsed.usage);
  if (!parsed.parsed_output) throw new Error("Could not structure the audit report");
  return parsed.parsed_output;
}

// Mirrors each completed content block into the activity log and the write
// guard. Runs as blocks complete; the stream itself is unaffected.
async function logBlock(block: Anthropic.Beta.BetaContentBlock, emit: EventSink, usage: RunUsage, writeAttempts: string[]): Promise<void> {
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
        await emit("fetch", `Fetching ${url ?? "page"}`, { url });
      }
      return;
    }
    case "web_fetch_tool_result": {
      const c = block.content as { type: string; url?: string; error_code?: string };
      if (c.type === "web_fetch_tool_result_error") await emit("warning", `Fetch failed: ${c.error_code ?? "error"}`, { url: c.url });
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
