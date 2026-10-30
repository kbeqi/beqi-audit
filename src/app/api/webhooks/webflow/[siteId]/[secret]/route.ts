import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/env";
import { newId } from "@/lib/id";
import { startRun } from "@/audit/start";

// Webflow site_publish webhook. The URL carries a per-site secret that was
// generated when the webhook was registered, so only Webflow (or someone who
// read the registration) can reach it. Starts a publish-triggered audit unless
// one is already running or the site was audited in the last 10 minutes.
export const dynamic = "force-dynamic";

const MIN_GAP_MS = 10 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string; secret: string }> }) {
  const { siteId, secret } = await params;
  const db = await getDb();
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, siteId) });
  if (!site || !site.webhookSecret || !timingSafeEqual(site.webhookSecret, secret)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const payload = (await request.json().catch(() => ({}))) as { triggerType?: string; payload?: { siteId?: string; domains?: string[]; publishedBy?: { displayName?: string } } };
  const detail = { triggerType: payload.triggerType ?? null, domains: payload.payload?.domains ?? null, publishedBy: payload.payload?.publishedBy?.displayName ?? null };
  if (payload.payload?.siteId && payload.payload.siteId !== site.webflowSiteId) {
    return NextResponse.json({ ok: false, reason: "site mismatch" }, { status: 400 });
  }
  const skip = async (reason: string) => {
    await db.insert(schema.auditLog).values({ id: newId(), siteId: site.id, actor: "webflow", action: "run.publish_skipped", detail: { ...detail, reason } });
    return NextResponse.json({ ok: true, started: false, reason });
  };
  if (!site.auditOnPublish) return skip("audit after publish is off for this site");
  if (!site.connectionId) return skip("site has no Webflow connection");
  const live = await db.query.runs.findFirst({ where: and(eq(schema.runs.siteId, site.id), inArray(schema.runs.status, ["queued", "running"])), columns: { id: true } });
  if (live) return skip("an audit is already running");
  const last = await db.query.runs.findFirst({ where: eq(schema.runs.siteId, site.id), orderBy: (r, { desc }) => desc(r.createdAt), columns: { createdAt: true } });
  if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) return skip("audited less than 10 minutes ago");

  const { env, ctx } = await getCtx();
  const { runId } = await startRun(env, site.id, "publish", (p) => ctx.waitUntil(p));
  await db.insert(schema.auditLog).values({ id: newId(), siteId: site.id, actor: "webflow", action: "run.publish_triggered", detail: { ...detail, runId } });
  return NextResponse.json({ ok: true, started: true, runId });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
