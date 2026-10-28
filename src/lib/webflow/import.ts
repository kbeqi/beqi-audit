// Imports (or refreshes) the sites a Webflow connection can see. Existing site
// rows keep their settings and history and are re-pointed at the connection.

import { eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { WebflowConnection } from "@/db/schema";
import { newId } from "@/lib/id";
import { nextRunAfter } from "@/audit/start";
import { listWebflowSites, siteBaseUrl } from "./mcp-client";

export async function importSitesForConnection(db: Db, connection: WebflowConnection, env: Pick<CloudflareEnv, "WEBFLOW_MCP_URL">): Promise<{ imported: number; workspaceId: string | null }> {
  const sites = await listWebflowSites(connection.mcpServerUrl ?? env.WEBFLOW_MCP_URL, connection.accessToken);
  let imported = 0;
  for (const s of sites) {
    const existing = await db.query.sites.findFirst({ where: eq(schema.sites.webflowSiteId, s.id) });
    if (existing) {
      await db
        .update(schema.sites)
        .set({ connectionId: connection.id, name: s.displayName, shortName: s.shortName, previewUrl: s.previewUrl ?? null })
        .where(eq(schema.sites.id, existing.id));
    } else {
      await db.insert(schema.sites).values({
        id: newId(),
        clientId: connection.clientId,
        connectionId: connection.id,
        webflowSiteId: s.id,
        name: s.displayName,
        shortName: s.shortName,
        baseUrl: siteBaseUrl(s),
        previewUrl: s.previewUrl ?? null,
        auditFrequency: "weekly",
        nextRunAt: nextRunAfter("weekly"),
      });
    }
    imported++;
  }
  const workspaceId = sites[0]?.workspaceId ?? null;
  await db
    .update(schema.webflowConnections)
    .set({
      authorizedSiteIds: sites.map((s) => s.id),
      workspaceId: workspaceId ?? connection.workspaceId,
      label: workspaceId ? `Workspace ${workspaceId.slice(-6)}` : connection.label,
    })
    .where(eq(schema.webflowConnections.id, connection.id));
  return { imported, workspaceId };
}
