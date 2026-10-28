import Anthropic from "@anthropic-ai/sdk";
import type { RunUsage } from "@/db/schema";

export const MODEL = "claude-opus-5-5";

// Beta features the engine relies on: the MCP connector (Webflow's hosted MCP
// server) and server-side refusal fallbacks.
export const BETAS = ["mcp-client-2026-09-15", "server-side-fallback-2026-07-01"];

export function getAnthropic(env: Pick<CloudflareEnv, "ANTHROPIC_API_KEY">): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  // Agent turns with many MCP calls run for minutes; the SDK default (10 min) is
  // too tight for a large site.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 25 * 60 * 1000 });
}

// List prices for claude-opus-5-5, USD per million tokens.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export function emptyUsage(): RunUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: 0, webFetches: 0, apiCalls: 0, durationMs: 0, estimatedCostUsd: 0 };
}

export function addUsage(total: RunUsage, u: Anthropic.Beta.BetaUsage | Anthropic.Messages.Usage): void {
  total.inputTokens += u.input_tokens ?? 0;
  total.outputTokens += u.output_tokens ?? 0;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
  total.apiCalls += 1;
  total.estimatedCostUsd =
    Math.round(
      ((total.inputTokens * PRICE.input + total.outputTokens * PRICE.output + total.cacheReadTokens * PRICE.cacheRead + total.cacheWriteTokens * PRICE.cacheWrite) / 1_000_000) * 10_000,
    ) / 10_000;
}
