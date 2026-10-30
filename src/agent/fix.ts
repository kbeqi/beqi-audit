// The fix agent: applies one approved proposal through Webflow's MCP server,
// reads the result back, and reports what changed.

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Finding, FixProposal, RunUsage, Site, WebflowConnection } from "@/db/schema";
import { addUsage, AUDIT_MODEL, BETAS, emptyUsage, FIX_MODEL, getAnthropic } from "./anthropic";
import type { EventSink } from "./events";
import { AGENT_HARNESS, FIX_SYSTEM_PROMPT, fixTaskPrompt } from "./prompts";
import { FixResultSchema, type FixResult } from "./schemas";
import { FIX_TOOLS, actionsOfToolCall, describeToolCall, isWriteAction, webflowMcpServer, webflowToolset } from "./webflow-mcp";
import type { AgentEnv } from "./audit";

const MAX_CONTINUATIONS = 6;

export interface FixAgentInput {
  env: AgentEnv;
  site: Site;
  connection: WebflowConnection;
  proposal: FixProposal;
  finding: Finding | null;
  emit: EventSink;
}

export interface FixAgentOutput {
  result: FixResult;
  usage: RunUsage;
  writes: string[];
  messages: Anthropic.Beta.BetaMessageParam[];
}

export async function runFixAgent(input: FixAgentInput): Promise<FixAgentOutput> {
  const { env, site, connection, proposal, finding, emit } = input;
  const client = getAnthropic(env);
  const started = Date.now();
  const usage = emptyUsage();
  const agentId = `${FIX_MODEL}|${AGENT_HARNESS}|fix-${proposal.id.slice(-6)}`;
  const writes: string[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: fixTaskPrompt({ site, finding, proposal, agentId }) }];
  let finalText = "";

  await emit("status", `Applying with ${FIX_MODEL}: ${proposal.title ?? proposal.action}`, { model: FIX_MODEL });

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = client.beta.messages.stream({
      model: FIX_MODEL,
      max_tokens: 32000,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: FIX_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      mcp_servers: [webflowMcpServer(connection, env)],
      tools: [webflowToolset(FIX_TOOLS)],
      messages,
    });

    stream.on("contentBlock", (block) => {
      void (async () => {
        if (block.type === "mcp_tool_use") {
          usage.toolCalls += 1;
          const actions = actionsOfToolCall(block.input);
          const w = actions.filter((a) => isWriteAction(block.name, a));
          if (w.length) writes.push(`${block.name}:${w.join("/")}`);
          await emit("tool_call", describeToolCall(block.name, block.input), { tool: block.name, actions, write: w.length > 0 });
        } else if (block.type === "mcp_tool_result" && block.is_error) {
          const text = typeof block.content === "string" ? block.content : block.content.map((c) => c.text).join("");
          await emit("warning", `Webflow tool error: ${text.slice(0, 200)}`);
        } else if (block.type === "text" && block.text.trim()) {
          await emit("text", block.text.trim().slice(0, 400));
        }
      })();
    });

    const message = await stream.finalMessage();
    addUsage(usage, message.usage, message.model);
    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "pause_turn") continue;
    if (message.stop_reason === "refusal") throw new Error("The model declined to apply this fix");
    if (message.stop_reason === "max_tokens") throw new Error("Fix output was cut off (max_tokens)");
    finalText = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    break;
  }
  if (!finalText.trim()) throw new Error("The fix agent produced no result");

  // Structuring the short result needs no judgement; the audit model is cheaper.
  const parsed = await client.messages.parse({
    model: AUDIT_MODEL,
    max_tokens: 8000,
    system: "Convert the agent's fix report to the schema. Copy values faithfully.",
    output_config: { format: zodOutputFormat(FixResultSchema), effort: "low" },
    messages: [{ role: "user", content: finalText }],
  });
  addUsage(usage, parsed.usage, parsed.model);
  if (!parsed.parsed_output) throw new Error("Could not structure the fix result");
  usage.durationMs = Date.now() - started;
  const result = parsed.parsed_output;
  await emit("done", `${result.status}: ${result.summary}`, { needsPublish: result.needsPublish, costUsd: usage.estimatedCostUsd });
  return { result, usage, writes, messages };
}
