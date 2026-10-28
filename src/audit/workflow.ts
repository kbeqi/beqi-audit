import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { stepAgent, stepAiVisibility, stepAnalyze, stepFinalize, stepMetrics, stepPrepare } from "./runner";
import { applyProposal } from "./fixer";
import type { AuditWorkflowParams } from "./start";

const quick = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" } as const;
// One agent conversation can run for many minutes on a large site. A retry
// starts a fresh conversation, so keep it to one.
const agent = { retries: { limit: 1, delay: "1 minute", backoff: "constant" }, timeout: "30 minutes" } as const;
// PageSpeed takes up to a minute per page; the AI sample is up to 40 short calls.
const slow = { retries: { limit: 1, delay: "30 seconds", backoff: "constant" }, timeout: "15 minutes" } as const;

// One Workflow handles both audits and approved fixes (see wrangler.jsonc).
export class AuditRunWorkflow extends WorkflowEntrypoint<CloudflareEnv, AuditWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<AuditWorkflowParams>>, step: WorkflowStep) {
    const env = this.env;
    const params = event.payload;
    if (params.kind === "fix") {
      return step.do("apply-fix", agent, () => applyProposal(env, params.proposalId));
    }
    const { runId } = params;
    try {
      await step.do("prepare", quick, () => stepPrepare(env, runId));
      await step.do("metrics", slow, () => stepMetrics(env, runId));
      await step.do("agent", agent, () => stepAgent(env, runId));
      // The AI sample is optional: a failure here must not fail the audit.
      await step.do("ai-visibility", slow, () => stepAiVisibility(env, runId)).catch((e) => console.warn("ai visibility step failed", e));
      const result = await step.do("analyze", quick, () => stepAnalyze(env, runId));
      await step.do("finalize", quick, () => stepFinalize(env, runId));
      return result;
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      await step.do("fail", quick, () => stepFinalize(env, runId, message));
      throw e;
    }
  }
}
