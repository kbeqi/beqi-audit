// Direct calls to Webflow's MCP server from the Worker (no model involved), for
// the few things the app does itself: importing a workspace's sites after it
// connects and testing a connection.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpSite {
  id: string;
  workspaceId?: string;
  displayName: string;
  shortName: string;
  previewUrl?: string;
  lastPublished?: string;
  customDomains?: { id?: string; url: string }[];
}

interface ToolResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

export async function callWebflowTool(opts: { serverUrl: string; token: string; name: string; args: Record<string, unknown> }): Promise<string> {
  const transport = new StreamableHTTPClientTransport(new URL(opts.serverUrl), {
    requestInit: { headers: { authorization: `Bearer ${opts.token}` } },
  });
  const client = new Client({ name: "beqi-audit", version: "0.2.0" });
  await client.connect(transport);
  try {
    const res = (await client.callTool({ name: opts.name, arguments: opts.args })) as ToolResult;
    const text = (res.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    if (res.isError) throw new Error(`Webflow MCP ${opts.name} failed: ${text.slice(0, 300)}`);
    return text;
  } finally {
    await client.close().catch(() => {});
  }
}

// Every Webflow tool call carries these; "start" asks the server for a session.
function protocolArgs(context: string) {
  return { session_id: "start", agent_id: "beqi-audit|worker|import", context };
}

export async function listWebflowSites(serverUrl: string, token: string): Promise<McpSite[]> {
  const text = await callWebflowTool({
    serverUrl,
    token,
    name: "data_sites_tool",
    args: { action: "list_sites", ...protocolArgs("Beqi Audit lists the workspace's sites right after a connection is authorized, so they can be imported.") },
  });
  const json = extractJson(text);
  const sites = Array.isArray(json) ? json : ((json as { sites?: McpSite[] } | null)?.sites ?? []);
  return (sites as McpSite[]).filter((s) => s && typeof s.id === "string");
}

// Tool results are text; the JSON payload may be preceded by a session notice.
function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const starts: number[] = [];
  for (const needle of ['{"', "[{", "[]"]) {
    let i = text.indexOf(needle);
    while (i !== -1 && starts.length < 20) {
      starts.push(i);
      i = text.indexOf(needle, i + 1);
    }
  }
  starts.sort((a, b) => a - b);
  for (const start of starts) {
    for (const end of [text.lastIndexOf("}"), text.lastIndexOf("]")]) {
      if (end <= start) continue;
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

// Picks the URL the audit should use: first custom domain, else the webflow.io preview.
export function siteBaseUrl(site: McpSite): string {
  const custom = site.customDomains?.[0]?.url;
  if (custom) return custom.startsWith("http") ? custom : `https://${custom}`;
  return `https://${site.shortName}.webflow.io`;
}
