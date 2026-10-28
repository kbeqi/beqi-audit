// Direct calls to Webflow's MCP server from the Worker (no model involved), for
// the few things the app does itself: importing a workspace's sites after it
// connects and testing a connection.
//
// Protocol: every Webflow tool call carries session_id, agent_id and context.
// The first call of a session must be webflow_guide_tool with session_id
// "start"; its reply issues a `ses_...` id that every later call must send.

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

const AGENT_ID = "beqi-audit|worker|import";

export class WebflowSession {
  private sessionId = "start";
  private constructor(private readonly client: Client) {}

  static async open(serverUrl: string, token: string): Promise<WebflowSession> {
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "beqi-audit", version: "0.2.0" });
    await client.connect(transport);
    const session = new WebflowSession(client);
    const text = await session.call("webflow_guide_tool", {}, "Beqi Audit opens a Webflow MCP session before importing a workspace's sites.", true);
    const issued = /ses_[0-9A-Za-z]{27}/.exec(text)?.[0];
    if (!issued) throw new Error("Webflow's MCP server did not issue a session id");
    session.sessionId = issued;
    return session;
  }

  async call(name: string, args: Record<string, unknown>, context: string, allowNotice = false): Promise<string> {
    const res = (await this.client.callTool({
      name,
      arguments: { ...args, session_id: this.sessionId, agent_id: AGENT_ID, context },
    })) as ToolResult;
    const text = (res.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    if (res.isError && !allowNotice) throw new Error(`Webflow MCP ${name} failed: ${text.slice(0, 300)}`);
    return text;
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => {});
  }
}

export async function listWebflowSites(serverUrl: string, token: string): Promise<McpSite[]> {
  const session = await WebflowSession.open(serverUrl, token);
  try {
    const text = await session.call(
      "data_sites_tool",
      { action: "list_sites" },
      "Beqi Audit lists the workspace's sites right after a connection is authorized, so they can be imported.",
    );
    const json = extractJson(text);
    const sites = Array.isArray(json) ? json : ((json as { sites?: McpSite[] } | null)?.sites ?? []);
    const out = (sites as McpSite[]).filter((s) => s && typeof s.id === "string");
    if (!out.length && !/\[\s*\]|"sites"\s*:\s*\[\s*\]/.test(text)) {
      throw new Error(`Could not read the site list from Webflow: ${text.slice(0, 200)}`);
    }
    return out;
  } finally {
    await session.close();
  }
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
