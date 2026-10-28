import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// IDs are ULID-like random strings generated in app code (see src/lib/id.ts).
// Timestamps are ISO-8601 strings in UTC; D1 has no native datetime type.

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export type UserRole = "admin" | "member";

// Team members who may sign in. ADMIN_EMAILS (wrangler.jsonc) are admins even
// without a row, so the first sign-in bootstraps the table.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").$type<UserRole>().notNull().default("member"),
  invitedBy: text("invited_by"),
  lastLoginAt: text("last_login_at"),
  disabledAt: text("disabled_at"),
  createdAt: text("created_at").notNull().default(now),
});

// One-time sign-in links. Only the hash of the token is stored.
export const loginTokens = sqliteTable(
  "login_tokens",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("login_tokens_email_idx").on(t.email, t.createdAt)],
);

// Browser sessions, revocable server-side. The cookie holds the raw token.
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    userAgent: text("user_agent"),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  notes: text("notes"),
  // Logo stored in AUDIT_STORE under this key (served by /api/clients/<id>/logo).
  logoKey: text("logo_key"),
  logoUpdatedAt: text("logo_updated_at"),
  // Where audit emails for this client go (one address, or several separated
  // by commas). Empty means no emails.
  notifyEmail: text("notify_email"),
  // A reminder about a day before each scheduled audit.
  notifyReminder: integer("notify_reminder", { mode: "boolean" }).notNull().default(true),
  // Score, counts and highlights when an audit finishes.
  notifyResults: integer("notify_results", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(now),
});

export type ConnectionAuthKind = "mcp_oauth" | "api_token";

// One row per authorization against Webflow's hosted MCP server. A Beqi team
// member authorizes once per client workspace; the token is what Claude uses
// (through the Anthropic MCP connector) to read and fix the client's sites.
export const webflowConnections = sqliteTable(
  "webflow_connections",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    label: text("label"),
    workspaceId: text("workspace_id"),
    workspaceName: text("workspace_name"),
    authKind: text("auth_kind").$type<ConnectionAuthKind>().notNull().default("mcp_oauth"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: text("expires_at"),
    scopes: text("scopes").notNull(),
    // OAuth client registered dynamically with the MCP server (RFC 7591), kept so
    // tokens can be refreshed without a new authorization.
    mcpServerUrl: text("mcp_server_url"),
    tokenEndpoint: text("token_endpoint"),
    mcpClientId: text("mcp_client_id"),
    mcpClientSecret: text("mcp_client_secret"),
    // JSON array of Webflow site ids this token was authorized for.
    authorizedSiteIds: text("authorized_site_ids", { mode: "json" }).$type<string[]>().notNull(),
    authorizedBy: text("authorized_by"),
    createdAt: text("created_at").notNull().default(now),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("webflow_connections_client_idx").on(t.clientId)],
);

export type AuditFrequency = "daily" | "every3days" | "weekly" | "biweekly" | "monthly" | "off";

export const FREQUENCY_LABELS: Record<AuditFrequency, string> = {
  daily: "Daily",
  every3days: "Every 3 days",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  off: "Off (manual only)",
};

export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => webflowConnections.id, {
      onDelete: "set null",
    }),
    webflowSiteId: text("webflow_site_id").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    // Primary published URL used by the crawler, e.g. https://www.example.com
    baseUrl: text("base_url").notNull(),
    previewUrl: text("preview_url"),
    auditFrequency: text("audit_frequency").$type<AuditFrequency>().notNull().default("weekly"),
    nextRunAt: text("next_run_at"),
    // The next_run_at a reminder email was sent for, so each scheduled audit
    // gets exactly one reminder.
    reminderSentFor: text("reminder_sent_for"),
    lastRunId: text("last_run_id"),
    // JSON array of paths that get PageSpeed runs and screenshots, e.g. ["/", "/pricing"].
    keyPages: text("key_pages", { mode: "json" }).$type<string[]>().notNull().default(sql`'["/"]'`),
    maxPages: integer("max_pages").notNull().default(200),
    isEnterprise: integer("is_enterprise", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("sites_webflow_site_idx").on(t.webflowSiteId),
    index("sites_client_idx").on(t.clientId),
    index("sites_next_run_idx").on(t.nextRunAt),
  ],
);

export type RunTrigger = "schedule" | "manual" | "publish";
export type RunStatus = "queued" | "running" | "complete" | "failed";

export type CategoryKey =
  | "seo"
  | "aeo"
  | "performance"
  | "links"
  | "unused"
  | "naming";

export type CategoryScores = Partial<Record<CategoryKey, number>>;

export interface RunSummary {
  pagesTotal: number;
  pagesReviewed: number;
  findingsBySeverity: Record<Severity, number>;
  findingsByCategory: Record<CategoryKey, number>;
  newFindings: number;
  resolvedFindings: number;
  proposals: number;
}

// Token usage and cost of the agent calls behind a run.
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  webFetches: number;
  apiCalls: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<RunTrigger>().notNull(),
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    workflowInstanceId: text("workflow_instance_id"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    scoreOverall: integer("score_overall"),
    scores: text("scores", { mode: "json" }).$type<CategoryScores>(),
    summary: text("summary", { mode: "json" }).$type<RunSummary>(),
    // The model that produced the audit and what it cost.
    model: text("model"),
    usage: text("usage", { mode: "json" }).$type<RunUsage>(),
    // Claude's own narrative of the audit (markdown) and its top highlights.
    agentSummary: text("agent_summary"),
    highlights: text("highlights", { mode: "json" }).$type<string[]>(),
    // Public read-only report link (/share/<token>); null when not shared.
    shareToken: text("share_token").unique(),
    sharedAt: text("shared_at"),
    sharedBy: text("shared_by"),
    error: text("error"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("runs_site_created_idx").on(t.siteId, t.createdAt)],
);

export type RunEventKind = "status" | "tool_call" | "tool_result" | "fetch" | "text" | "warning" | "error" | "done";

// Live activity log of an agent stream (an audit run or a fix application),
// written as the agent works so the UI can show progress.
export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    // Audit run id or fix proposal id: whichever agent stream the event belongs to.
    streamId: text("stream_id").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind").$type<RunEventKind>().notNull(),
    title: text("title").notNull(),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("run_events_stream_idx").on(t.streamId, t.seq)],
);

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    category: text("category").$type<CategoryKey>().notNull(),
    checkId: text("check_id").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    pagePath: text("page_path"),
    webflowPageId: text("webflow_page_id"),
    // Stable identity of a finding across runs: hash(check_id + page_path + subject).
    fingerprint: text("fingerprint").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
    // Set when an ignore rule suppressed this finding in this run.
    ignored: integer("ignored", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("findings_run_idx").on(t.runId),
    index("findings_site_fingerprint_idx").on(t.siteId, t.fingerprint),
  ],
);

export type FindingLifecycle = "open" | "fixed" | "ignored" | "false_positive";

// Lifecycle of a finding across runs, keyed by fingerprint.
export const findingStates = sqliteTable(
  "finding_states",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").$type<FindingLifecycle>().notNull().default("open"),
    firstSeenRunId: text("first_seen_run_id").notNull(),
    lastSeenRunId: text("last_seen_run_id").notNull(),
    resolvedRunId: text("resolved_run_id"),
    note: text("note"),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("finding_states_pk").on(t.siteId, t.fingerprint)],
);

export const pageMetrics = sqliteTable(
  "page_metrics",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    pagePath: text("page_path").notNull(),
    strategy: text("strategy").$type<"mobile" | "desktop">().notNull(),
    performanceScore: integer("performance_score"),
    lcpMs: real("lcp_ms"),
    cls: real("cls"),
    inpMs: real("inp_ms"),
    tbtMs: real("tbt_ms"),
    fcpMs: real("fcp_ms"),
    totalBytes: integer("total_bytes"),
    // CrUX field data when available.
    fieldLcpMs: real("field_lcp_ms"),
    fieldCls: real("field_cls"),
    fieldInpMs: real("field_inp_ms"),
    raw: text("raw", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("page_metrics_site_path_idx").on(t.siteId, t.pagePath, t.createdAt)],
);

export type SnapshotKind = "pages" | "scripts" | "custom_code" | "css_classes" | "crawl";

// Per-run snapshots stored in the artifact store (KV today; column name kept for R2); `hash` lets the next run detect changes cheaply.
export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SnapshotKind>().notNull(),
    r2Key: text("r2_key").notNull(),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("snapshots_site_kind_idx").on(t.siteId, t.kind, t.createdAt)],
);

// "resolved": a person fixed it on the site themselves; the next audit confirms.
export type ProposalStatus = "proposed" | "approved" | "applying" | "applied" | "resolved" | "rejected" | "reverted" | "failed";
export type ProposalRisk = "low" | "medium" | "high";

export interface ProposalChange {
  field: string;
  from: string | null;
  to: string;
}

export interface ProposalTarget {
  pageId: string | null;
  pagePath: string | null;
  assetId: string | null;
  elementId: string | null;
  scriptId: string | null;
}

// What the fix agent reported after applying a proposal.
export interface ProposalResult {
  status: "applied" | "skipped" | "failed" | "manual";
  summary: string;
  changesMade: ProposalChange[];
  verification: string;
  needsPublish: boolean;
}

// Agent-drafted fixes. Nothing is written to Webflow until status is "approved".
export const fixProposals = sqliteTable(
  "fix_proposals",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    findingId: text("finding_id").references(() => findings.id, { onDelete: "set null" }),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").$type<ProposalStatus>().notNull().default("proposed"),
    // One of the fix actions in src/agent/catalog.ts, e.g. "page_seo", "schema_markup".
    action: text("action").notNull(),
    title: text("title"),
    risk: text("risk").$type<ProposalRisk>(),
    target: text("target", { mode: "json" }).$type<ProposalTarget>(),
    proposal: text("proposal", { mode: "json" }).$type<{ changes: ProposalChange[] }>().notNull(),
    previous: text("previous", { mode: "json" }).$type<Record<string, unknown>>(),
    rationale: text("rationale"),
    approvedBy: text("approved_by"),
    appliedBy: text("applied_by"),
    appliedAt: text("applied_at"),
    result: text("result", { mode: "json" }).$type<ProposalResult>(),
    error: text("error"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("fix_proposals_site_status_idx").on(t.siteId, t.status)],
);

export const ignoreRules = sqliteTable(
  "ignore_rules",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    checkId: text("check_id").notNull(),
    // null = applies to every page
    pagePath: text("page_path"),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("ignore_rules_site_idx").on(t.siteId)],
);

// Every write the app or the agent makes against a client site, plus admin actions.
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").references(() => sites.id, { onDelete: "set null" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("audit_log_site_idx").on(t.siteId, t.createdAt)],
);

export type Client = typeof clients.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type WebflowConnection = typeof webflowConnections.$inferSelect;
export type PageMetric = typeof pageMetrics.$inferSelect;
export type FixProposal = typeof fixProposals.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type User = typeof users.$inferSelect;
export type IgnoreRule = typeof ignoreRules.$inferSelect;
