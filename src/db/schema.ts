import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// IDs are ULID-like random strings generated in app code (see src/lib/id.ts).
// Timestamps are ISO-8601 strings in UTC; D1 has no native datetime type.

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(now),
});

// One row per Webflow OAuth grant. A client with sites in several workspaces
// authorizes once per workspace, so a client can have several connections.
export const webflowConnections = sqliteTable(
  "webflow_connections",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id"),
    workspaceName: text("workspace_name"),
    accessToken: text("access_token").notNull(),
    scopes: text("scopes").notNull(),
    // JSON array of Webflow site ids this token was authorized for.
    authorizedSiteIds: text("authorized_site_ids", { mode: "json" }).$type<string[]>().notNull(),
    authorizedBy: text("authorized_by"),
    createdAt: text("created_at").notNull().default(now),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("webflow_connections_client_idx").on(t.clientId)],
);

export type AuditFrequency = "daily" | "weekly" | "monthly" | "off";

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
  pagesCrawled: number;
  findingsBySeverity: Record<Severity, number>;
  findingsByCategory: Record<CategoryKey, number>;
  newFindings: number;
  resolvedFindings: number;
  // Snapshot kinds whose hash differs from the previous complete run.
  changedSinceLastRun?: string[];
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
    error: text("error"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("runs_site_created_idx").on(t.siteId, t.createdAt)],
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

// Per-run snapshots stored in R2; `hash` lets the next run detect changes cheaply.
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

export type ProposalStatus = "proposed" | "approved" | "applied" | "rejected" | "reverted" | "failed";

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
    // e.g. "page_seo", "schema_markup", "sitemap_flag", "remove_script"
    action: text("action").notNull(),
    proposal: text("proposal", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    previous: text("previous", { mode: "json" }).$type<Record<string, unknown>>(),
    rationale: text("rationale"),
    approvedBy: text("approved_by"),
    appliedAt: text("applied_at"),
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
