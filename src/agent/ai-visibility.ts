// AI visibility sample: asks AI assistants the questions a prospective customer
// would ask, and records whether the brand is mentioned, cited and described
// accurately. It is a sample (a handful of prompts, two runs each, two
// engines), never a market-share number; the UI says so.
//
// Engines: Perplexity (Sonar, when PERPLEXITY_API_KEY is set) and Claude with
// web search. Both are live web-backed answers, which is what a customer gets.

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AiEngine, AiVisibilitySummary, RunUsage } from "@/db/schema";
import { CHECKS, type CheckId } from "./catalog";
import type { EventSink } from "./events";
import { addUsage, BETAS, getAnthropic, MODEL } from "./anthropic";
import { AiAnswerJudgementSchema } from "./schemas";
import type { FindingDraft } from "@/audit/types";

export type AiVisibilityEnv = Pick<CloudflareEnv, "ANTHROPIC_API_KEY" | "PERPLEXITY_API_KEY">;

const MAX_PROMPTS = 10;
const ITERATIONS = 2;
const MAX_CALLS = 40;
const CONCURRENCY = 4;
const PERPLEXITY_MODEL = "sonar";

export interface SampledAnswer {
  prompt: string;
  engine: AiEngine;
  iteration: number;
  answer: string;
  citations: string[];
  mentioned: boolean;
  cited: boolean;
  recommended: boolean;
  issues: string[];
}

export interface AiVisibilityInput {
  env: AiVisibilityEnv;
  siteHost: string;
  brandName: string;
  brandAliases: string[];
  keyFacts: string[];
  prompts: string[];
  usage: RunUsage;
  emit: EventSink;
}

export interface AiVisibilityOutput {
  answers: SampledAnswer[];
  summary: AiVisibilitySummary;
  findings: FindingDraft[];
  errors: string[];
}

export async function sampleAiVisibility(input: AiVisibilityInput): Promise<AiVisibilityOutput> {
  const { env, emit, usage } = input;
  const prompts = [...new Set(input.prompts.map((p) => p.trim()).filter(Boolean))].slice(0, MAX_PROMPTS);
  const engines: AiEngine[] = [];
  if (env.PERPLEXITY_API_KEY) engines.push("perplexity");
  if (env.ANTHROPIC_API_KEY) engines.push("claude");
  const errors: string[] = [];

  if (prompts.length === 0 || engines.length === 0) {
    const why = prompts.length === 0 ? "no prompts to ask" : "no AI engine configured";
    return { answers: [], summary: emptySummary(0, `Not sampled: ${why}.`), findings: [unavailable(why)], errors: [why] };
  }

  const jobs: { prompt: string; engine: AiEngine; iteration: number }[] = [];
  for (const engine of engines) for (const prompt of prompts) for (let i = 1; i <= ITERATIONS; i++) jobs.push({ prompt, engine, iteration: i });
  const limited = jobs.slice(0, MAX_CALLS);
  await emit("status", `Sampling AI answers: ${prompts.length} prompts × ${engines.join(" + ")} × ${ITERATIONS}`, { prompts: prompts.length, engines });

  const client = env.ANTHROPIC_API_KEY ? getAnthropic(env) : null;
  const raw: (Omit<SampledAnswer, "mentioned" | "cited" | "recommended" | "issues"> | null)[] = new Array(limited.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < limited.length) {
      const i = next++;
      const job = limited[i];
      try {
        const r = job.engine === "perplexity" ? await askPerplexity(env.PERPLEXITY_API_KEY!, job.prompt) : await askClaude(client!, job.prompt, usage);
        raw[i] = { ...job, ...r };
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        errors.push(`${job.engine}: ${msg.slice(0, 160)}`);
        await emit("warning", `${job.engine} failed for "${job.prompt.slice(0, 60)}": ${msg.slice(0, 120)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, limited.length) }, worker));

  const names = [input.brandName, ...input.brandAliases].map((n) => n.trim()).filter((n) => n.length >= 2);
  const host = input.siteHost.replace(/^www\./, "").toLowerCase();
  const answers: SampledAnswer[] = raw
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({
      ...r,
      mentioned: mentions(r.answer, names),
      cited: r.citations.some((u) => sameSite(u, host)),
      recommended: false,
      issues: [],
    }));

  // One structured call judges the answers that talk about the brand.
  const toJudge = answers.map((a, index) => ({ a, index })).filter((x) => x.a.mentioned);
  if (client && toJudge.length) {
    try {
      await emit("status", `Checking ${toJudge.length} answers against the site's stated facts`);
      const parsed = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        output_config: { format: zodOutputFormat(AiAnswerJudgementSchema), effort: "medium" },
        system:
          "You check what AI assistants say about a business against the facts the business states on its own website. For each answer decide whether it recommends or lists the brand as an option, and list any claims about the brand that contradict the key facts. Quote the wrong claim briefly. Do not invent facts; an answer that says less than the site is not inaccurate.",
        messages: [
          {
            role: "user",
            content: `Brand: ${input.brandName}${input.brandAliases.length ? ` (also: ${input.brandAliases.join(", ")})` : ""}\nSite: ${input.siteHost}\n\nKey facts from the site:\n${input.keyFacts.map((f) => `- ${f}`).join("\n") || "- (none recorded)"}\n\nAnswers:\n${toJudge
              .map(({ a, index }) => `### Answer ${index} (${a.engine}, asked: "${a.prompt}")\n${a.answer.slice(0, 3000)}`)
              .join("\n\n")}`,
          },
        ],
      });
      addUsage(usage, parsed.usage);
      for (const j of parsed.parsed_output?.answers ?? []) {
        const a = answers[j.index];
        if (!a) continue;
        a.recommended = j.recommended;
        a.issues = j.issues.map((s) => s.trim()).filter(Boolean).slice(0, 5);
      }
    } catch (e) {
      errors.push(`judge: ${((e as Error).message ?? String(e)).slice(0, 160)}`);
      await emit("warning", "Could not check the sampled answers for accuracy");
    }
  }

  const summary = summarize(prompts.length, answers, engines, errors);
  const findings = answers.length ? visibilityFindings(answers, summary) : [unavailable(errors[0] ?? "every call failed")];
  await emit("done", `AI sample: mentioned in ${summary.mentioned}/${summary.answers}, cited ${summary.cited}, ${summary.inaccuracies} inaccurate claim(s)`, { ...summary });
  return { answers, summary, findings, errors };
}

function emptySummary(prompts: number, note: string): AiVisibilitySummary {
  return { prompts, answers: 0, mentioned: 0, cited: 0, recommended: 0, inaccuracies: 0, byEngine: {}, note };
}

function summarize(prompts: number, answers: SampledAnswer[], engines: AiEngine[], errors: string[]): AiVisibilitySummary {
  const byEngine: AiVisibilitySummary["byEngine"] = {};
  for (const e of engines) byEngine[e] = { answers: 0, mentioned: 0, cited: 0, recommended: 0 };
  let inaccuracies = 0;
  for (const a of answers) {
    const b = byEngine[a.engine];
    b.answers++;
    if (a.mentioned) b.mentioned++;
    if (a.cited) b.cited++;
    if (a.recommended) b.recommended++;
    inaccuracies += a.issues.length;
  }
  const note = `Sample of ${prompts} prompts, ${ITERATIONS} answers each from ${engines.map(engineLabel).join(" and ")}${errors.length ? ` (${errors.length} call(s) failed)` : ""}. Answers vary between runs; treat this as a signal, not a share.`;
  return {
    prompts,
    answers: answers.length,
    mentioned: answers.filter((a) => a.mentioned).length,
    cited: answers.filter((a) => a.cited).length,
    recommended: answers.filter((a) => a.recommended).length,
    inaccuracies,
    byEngine,
    note,
  };
}

export const engineLabel = (e: string) => (e === "perplexity" ? "Perplexity" : e === "claude" ? "Claude" : e);

function draft(checkId: CheckId, title: string, detail: string, evidence: string[], extra: Partial<FindingDraft> = {}): FindingDraft {
  const def = CHECKS[checkId];
  return { category: def.category, checkId, severity: def.severity, title, detail, data: { subject: extra.subject ?? null, evidence, source: "ai-sample" }, confidence: "high", effort: "large", ...extra };
}

function unavailable(why: string): FindingDraft {
  return draft("ai.sample-unavailable", "AI visibility sample not run", `The AI visibility sample could not run: ${why}.`, [why], { effort: "quick" });
}

function visibilityFindings(answers: SampledAnswer[], s: AiVisibilitySummary): FindingDraft[] {
  const out: FindingDraft[] = [];
  const perEngine = Object.entries(s.byEngine).map(([e, b]) => `${engineLabel(e)}: mentioned ${b.mentioned}/${b.answers}, cited ${b.cited}`);
  if (s.answers > 0 && s.mentioned / s.answers < 0.5) {
    out.push(
      draft(
        "ai.not-mentioned",
        `Mentioned in ${s.mentioned} of ${s.answers} sampled AI answers`,
        `When asked the questions a prospective customer would ask, AI assistants named the brand in ${s.mentioned} of ${s.answers} answers. Pages that answer those questions directly, with the brand named in the text, are what gets picked up.`,
        [...perEngine, ...answers.filter((a) => !a.mentioned).slice(0, 4).map((a) => `not mentioned: "${a.prompt}" (${engineLabel(a.engine)})`)],
      ),
    );
  }
  if (s.mentioned > 0 && s.cited === 0) {
    out.push(
      draft(
        "ai.not-cited",
        "Brand mentioned but the site is never cited",
        `AI assistants mentioned the brand in ${s.mentioned} answers but never linked to the site as a source; they are citing other pages for facts about the business.`,
        [...perEngine, ...answers.filter((a) => a.mentioned).slice(0, 3).map((a) => `cited instead: ${a.citations.slice(0, 3).join(", ") || "(no citations)"}`)],
        { effort: "moderate" },
      ),
    );
  }
  const seen = new Set<string>();
  for (const a of answers) {
    for (const issue of a.issues) {
      const key = issue.toLowerCase().replace(/\s+/g, " ").slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      const label = issue.replace(/^says\s+/i, "");
      out.push(
        draft("ai.inaccurate-claim", `AI answer ${label.slice(0, 100)}${label.length > 100 ? "…" : ""}`, `${engineLabel(a.engine)} stated this when asked "${a.prompt}". It contradicts what the site says. Make the correct fact explicit on the page that should answer this question.`, [`${engineLabel(a.engine)}: "${a.prompt}"`, issue], {
          subject: key,
          confidence: "medium",
          effort: "moderate",
        }),
      );
    }
  }
  return out;
}

function mentions(text: string, names: string[]): boolean {
  const hay = text.toLowerCase();
  return names.some((n) => {
    const needle = n.toLowerCase();
    const i = hay.indexOf(needle);
    if (i < 0) return false;
    const before = hay[i - 1] ?? " ";
    const after = hay[i + needle.length] ?? " ";
    return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
  });
}

function sameSite(url: string, host: string): boolean {
  try {
    const h = new URL(url).host.replace(/^www\./, "").toLowerCase();
    return h === host || h.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

// --- engines ---

interface PerplexityResponse {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string }[];
  error?: { message?: string };
}

async function askPerplexity(key: string, prompt: string): Promise<{ answer: string; citations: string[] }> {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: PERPLEXITY_MODEL, messages: [{ role: "user", content: prompt }] }),
  });
  const body = (await res.json().catch(() => ({}))) as PerplexityResponse;
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  const answer = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!answer) throw new Error("empty answer");
  const citations = [...new Set([...(body.citations ?? []), ...(body.search_results ?? []).map((r) => r.url ?? "")].filter(Boolean))];
  return { answer, citations };
}

async function askClaude(client: Anthropic, prompt: string, usage: RunUsage): Promise<{ answer: string; citations: string[] }> {
  // Streamed so a slow search round-trip is never cut off at the edge.
  const res = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 4000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: "low" },
      system: "You are a general-purpose assistant answering a member of the public. Search the web, then answer as you normally would: name specific businesses, products or sources when they fit, with the links you relied on.",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();
  addUsage(usage, res.usage);
  if (res.stop_reason === "refusal") throw new Error("the model declined");
  const text: string[] = [];
  const citations = new Set<string>();
  for (const block of res.content) {
    if (block.type === "text") {
      text.push(block.text);
      for (const c of block.citations ?? []) if (c.type === "web_search_result_location") citations.add(c.url);
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      // Fallback when the text carries no citations: the pages the model read.
      if (citations.size === 0) for (const r of block.content) if (r.type === "web_search_result") citations.add(r.url);
    }
  }
  const answer = text.join("").trim();
  if (!answer) throw new Error("empty answer");
  return { answer, citations: [...citations] };
}
