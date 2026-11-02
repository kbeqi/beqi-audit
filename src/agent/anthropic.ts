import Anthropic from "@anthropic-ai/sdk";
import type { RunUsage } from "@/db/schema";

// The audit (reading, cataloguing, scoring) runs on Opus 5.5: it is at the
// ceiling for that work and a large site costs several dollars per run. The
// fix agent, which writes to a client's site, runs on Fable 5.1: a fix is one
// short conversation, so the stronger model costs cents and buys care in the
// read-before-write check and the copy it writes.
export const AUDIT_MODEL = "claude-opus-5-5";
export const FIX_MODEL = "claude-fable-5-1";
export const MODEL = AUDIT_MODEL;

// Beta features the engine relies on: the MCP connector (Webflow's hosted MCP
// server) and server-side refusal fallbacks.
export const BETAS = ["mcp-client-2026-09-15", "server-side-fallback-2026-07-01"];

export function getAnthropic(env: Pick<CloudflareEnv, "ANTHROPIC_API_KEY">): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  // Agent turns with many MCP calls run for minutes; the SDK default (10 min) is
  // too tight for a large site.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 25 * 60 * 1000 });
}

// List prices, USD per million tokens.
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export function emptyUsage(): RunUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: 0, webFetches: 0, apiCalls: 0, durationMs: 0, estimatedCostUsd: 0 };
}

// Cost is accumulated per call at the price of the model that answered, so a
// run that mixes models (or is served by a fallback model) is priced right.
export function addUsage(total: RunUsage, u: Anthropic.Beta.BetaUsage | Anthropic.Messages.Usage, model: string = AUDIT_MODEL): void {
  const price = PRICES[model] ?? PRICES[AUDIT_MODEL];
  const inp = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  total.inputTokens += inp;
  total.outputTokens += out;
  total.cacheReadTokens += read;
  total.cacheWriteTokens += write;
  total.apiCalls += 1;
  total.estimatedCostUsd = Math.round((total.estimatedCostUsd + (inp * price.input + out * price.output + read * price.cacheRead + write * price.cacheWrite) / 1_000_000) * 10_000) / 10_000;
}
