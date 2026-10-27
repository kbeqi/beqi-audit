import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { stepAnalyze, stepCrawl, stepFinalize, stepLinks, stepPrepare, stepPsi } from "./runner";
import type { AuditWorkflowParams } from "./start";

const quick = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" } as const;
const long = { retries: { limit: 1, delay: "1 minute", backoff: "constant" }, timeout: "20 minutes" } as const;

export class AuditRunWorkflow extends WorkflowEntrypoint<CloudflareEnv, AuditWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<AuditWorkflowParams>>, step: WorkflowStep) {
    const { runId } = event.payload;
    const env = this.env;
    try {
      await step.do("prepare", quick, () => stepPrepare(env, runId));
      await step.do("crawl", long, () => stepCrawl(env, runId));
      await step.do("links", long, () => stepLinks(env, runId));
      await step.do("pagespeed", long, () => stepPsi(env, runId));
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
