import type { CategoryKey, Severity } from "@/db/schema";

// A finding as produced by the audit agent, before it gets an id/run/fingerprint.
export interface FindingDraft {
  category: CategoryKey;
  checkId: string;
  severity: Severity;
  title: string;
  detail?: string;
  pagePath?: string;
  webflowPageId?: string;
  // Extra identity for the fingerprint when several findings share check + page
  // (e.g. one per broken URL). Omit when check + page is already unique.
  subject?: string;
  data?: Record<string, unknown>;
}
