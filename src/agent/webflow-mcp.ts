// Webflow's hosted MCP server as seen by the Anthropic MCP connector, plus the
// read/write policy the engine enforces on top of it.
//
// Webflow exposes a handful of coarse tools (data_pages_tool, data_scripts_tool,
// ...) whose `action` argument selects the operation, so the connector's
// allow-list can only exclude whole tools. The audit run therefore gets a
// reduced tool set AND every call is classified afterwards: a write action during
// an audit fails the run.

import type Anthropic from "@anthropic-ai/sdk";
import type { WebflowConnection } from "@/db/schema";

export const WEBFLOW_MCP_SERVER_NAME = "webflow";

// Data tools only. Designer tools need an open Designer session and are useless
// headless; builders, campaigns, members, cloud apps and fonts are out of scope.
export const AUDIT_TOOLS = [
  "webflow_guide_tool",
  "data_sites_tool",
  "data_pages_tool",
  "data_scripts_tool",
  "data_cms_tool",
  "data_assets_tool",
  "data_sitemap_tool",
  "data_element_tool",
  "data_element_settings_tool",
  "data_forms_tool",
  "data_style_tool",
  "data_agent_instructions_tool",
];

// The fix agent uses the same tools; what it may write is constrained by the
// approved proposal and checked after the run (see src/agent/fix.ts).
export const FIX_TOOLS = AUDIT_TOOLS;

export function webflowMcpServer(
  connection: Pick<WebflowConnection, "accessToken" | "mcpServerUrl">,
  env: Pick<CloudflareEnv, "WEBFLOW_MCP_URL">,
): Anthropic.Beta.BetaRequestMCPServerURLDefinition {
  return {
    type: "url",
    name: WEBFLOW_MCP_SERVER_NAME,
    url: connection.mcpServerUrl ?? env.WEBFLOW_MCP_URL,
    authorization_token: connection.accessToken,
  };
}

// The allow-list lives on the toolset (the mcp-client-2026-09-15 beta rejects
// tool_configuration on the server definition): everything off by default,
// the listed tools on.
export function webflowToolset(allowedTools: string[]): Anthropic.Beta.BetaMCPToolset {
  return {
    type: "mcp_toolset",
    mcp_server_name: WEBFLOW_MCP_SERVER_NAME,
    default_config: { enabled: false },
    configs: Object.fromEntries(allowedTools.map((name) => [name, { enabled: true }])),
  };
}

const READ_PREFIXES = ["get_", "list_", "query_", "search_", "read_", "check_", "guide"];

// Action names inside a Webflow tool call. Tools take `actions: [{ label,
// <action_name>: {...} }]` (the action is the one key that isn't `label`); a
// few older shapes carry `action` / `type` strings, handled for completeness.
export function actionsOfToolCall(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const obj = input as Record<string, unknown>;
  const out: string[] = [];
  if (typeof obj.action === "string") out.push(obj.action);
  if (Array.isArray(obj.actions)) {
    for (const a of obj.actions) {
      if (!a || typeof a !== "object") continue;
      const rec = a as Record<string, unknown>;
      if (typeof rec.type === "string") out.push(rec.type);
      else if (typeof rec.action === "string") out.push(rec.action);
      else out.push(...Object.keys(rec).filter((k) => k !== "label"));
    }
  }
  return out;
}

export function isWriteAction(toolName: string, action: string): boolean {
  if (toolName === "webflow_guide_tool") return false;
  return !READ_PREFIXES.some((p) => action.startsWith(p));
}

// One line describing a tool call for the activity log.
export function describeToolCall(toolName: string, input: unknown): string {
  const actions = actionsOfToolCall(input);
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const firstAction = (Array.isArray(obj.actions) && obj.actions[0] && typeof obj.actions[0] === "object" ? obj.actions[0] : {}) as Record<string, unknown>;
  const inner = (Object.entries(firstAction).find(([k, v]) => k !== "label" && v && typeof v === "object")?.[1] ?? {}) as Record<string, unknown>;
  const where = [obj.page_id, obj.pageId, obj.siteId, inner.page_id, inner.site_id, inner.collection_id, inner.asset_id].find((v) => typeof v === "string") as string | undefined;
  const base = actions.length ? `${toolName} › ${actions.join(", ")}` : toolName;
  return where ? `${base} (${where})` : base;
}
