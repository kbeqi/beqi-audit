import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/webflow/oauth";
import { startRun } from "@/audit/start";

// Webflow `site_publish` webhook. Starts a publish-triggered audit run.
export async function POST(request: Request) {
  const { env, ctx } = await getCtx();
  const rawBody = await request.text();
  if (env.WEBFLOW_CLIENT_SECRET) {
    const ok = await verifyWebhookSignature({
      clientSecret: env.WEBFLOW_CLIENT_SECRET,
      timestamp: request.headers.get("x-webflow-timestamp"),
      signature: request.headers.get("x-webflow-signature"),
      rawBody,
    });
    if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: { triggerType?: string; payload?: { siteId?: string; domains?: string[]; publishedBy?: unknown } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (payload.triggerType !== "site_publish" || !payload.payload?.siteId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = await getDb();
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.webflowSiteId, payload.payload.siteId) });
  if (!site || !site.connectionId) return NextResponse.json({ ok: true, ignored: "unknown site" });

  const { runId, mode } = await startRun(env, site.id, "publish", (p) => ctx.waitUntil(p));
  return NextResponse.json({ ok: true, runId, mode });
}
