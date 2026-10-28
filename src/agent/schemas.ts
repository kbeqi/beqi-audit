// Structured shapes the agent must produce. The audit agent writes a report in
// prose + JSON; a second, tool-free call parses it into these schemas so the
// rest of the app only ever sees validated data.

import { z } from "zod";
import { AGENT_CHECK_IDS, FIX_ACTIONS } from "./catalog";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const EFFORTS = ["quick", "moderate", "large"] as const;

export const ReportFindingSchema = z.object({
  checkId: z.enum(AGENT_CHECK_IDS as [string, ...string[]]).describe("A check id from the catalog, verbatim"),
  severity: z.enum(SEVERITIES),
  confidence: z.enum(CONFIDENCES).describe("high: verified directly in a tool result or fetched page; medium: strongly indicated; low: inferred"),
  effort: z.enum(EFFORTS).describe("quick: minutes in Webflow or an approved fix; moderate: an hour or two of design/content work; large: a project"),
  title: z.string().describe("One line, specific to this page or subject"),
  detail: z.string().describe("What was observed and why it matters, 1-3 sentences"),
  pagePath: z.string().nullable().describe("Published path such as /pricing; null for site-wide findings"),
  webflowPageId: z.string().nullable().describe("Webflow page id when the finding is about one page"),
  subject: z
    .string()
    .nullable()
    .describe("Extra identity when several findings share check + page (a URL, asset id, script id); otherwise null"),
  evidence: z.array(z.string()).describe("Short verbatim evidence lines, at most 10"),
});
export type ReportFinding = z.infer<typeof ReportFindingSchema>;

export const ReportProposalSchema = z.object({
  findingIndex: z.number().int().describe("Index into findings[] of the finding this fix addresses"),
  action: z.enum(FIX_ACTIONS),
  title: z.string().describe("Short imperative label, e.g. 'Add meta description to /pricing'"),
  effort: z.enum(EFFORTS),
  target: z.object({
    pageId: z.string().nullable(),
    pagePath: z.string().nullable(),
    assetId: z.string().nullable(),
    elementId: z.string().nullable(),
    scriptId: z.string().nullable(),
  }),
  changes: z.array(
    z.object({
      field: z.string().describe("e.g. seo.title, seo.description, openGraph.title, jsonLd, includeInSitemap, altText, headingLevel"),
      from: z.string().nullable().describe("Current value, or null if none"),
      to: z.string().describe("Exact new value to write"),
    }),
  ),
  rationale: z.string(),
  risk: z.enum(["low", "medium", "high"]),
});
export type ReportProposal = z.infer<typeof ReportProposalSchema>;

export const AuditReportSchema = z.object({
  siteFacts: z.object({
    pagesTotal: z.number().int().describe("Static pages in Webflow (excluding drafts, archived, folders, templates)"),
    pagesReviewed: z.number().int().describe("Pages whose live HTML was fetched and inspected"),
    hasCustomDomain: z.boolean(),
    cmsCollections: z.number().int(),
    brandName: z.string().describe("The business name as the site presents it"),
    brandAliases: z.array(z.string()).describe("Other spellings, legal names or product names used on the site, up to 5"),
    keyFacts: z.array(z.string()).describe("5-10 short, verifiable facts about the business stated on the site: what it does, who for, where, products/services, pricing or plan facts, founding/ownership. Used to check AI answers for accuracy."),
    notes: z.array(z.string()).describe("Anything that limited the audit (tool errors, plan restrictions, caps hit)"),
  }),
  aiPrompts: z
    .array(z.string())
    .describe("6-10 questions a prospective customer might ask an AI assistant where this site should be the answer or a cited source. Natural language, no brand name in most of them (e.g. 'best Webflow agency in Tirana', 'how much does X cost'); include 1-2 branded ones ('what does <brand> do')."),
  summary: z.string().describe("2-4 short paragraphs of markdown for the site owner: overall health, what matters most, what to do first"),
  highlights: z.array(z.string()).describe("Up to 6 one-line highlights, most important first"),
  findings: z.array(ReportFindingSchema),
  proposals: z.array(ReportProposalSchema),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

export const FixResultSchema = z.object({
  status: z.enum(["applied", "skipped", "failed"]),
  summary: z.string().describe("What was changed, in one or two sentences"),
  changesMade: z.array(
    z.object({
      field: z.string(),
      from: z.string().nullable(),
      to: z.string(),
    }),
  ),
  verification: z.string().describe("How the change was verified by reading it back, or why it could not be"),
  needsPublish: z.boolean().describe("True when the site must be published for the change to go live"),
});
export type FixResult = z.infer<typeof FixResultSchema>;

// Scoring of sampled AI answers against the site's stated facts.
export const AiAnswerJudgementSchema = z.object({
  answers: z.array(
    z.object({
      index: z.number().int(),
      recommended: z.boolean().describe("The answer recommends or lists the brand as an option for the asker"),
      issues: z.array(z.string()).describe("Claims about the brand in this answer that contradict the key facts; each one short and quoting the wrong claim. Empty when none."),
    }),
  ),
});
export type AiAnswerJudgement = z.infer<typeof AiAnswerJudgementSchema>;
