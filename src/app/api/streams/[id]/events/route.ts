import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { currentActorOrNull, isTeam } from "@/lib/auth";
import { eventsAfter } from "@/lib/queries";

// GET /api/streams/<runId|proposalId>/events?after=<seq>
// Polled by the live activity log. `live` tells the client whether to keep polling.
// Client users only see streams that belong to their own client's sites.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActorOrNull();
  if (!actor) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, id), columns: { status: true, siteId: true } });
  const proposal = run ? null : await db.query.fixProposals.findFirst({ where: eq(schema.fixProposals.id, id), columns: { status: true, siteId: true } });
  const siteId = run?.siteId ?? proposal?.siteId ?? null;
  if (!siteId) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isTeam(actor)) {
    const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, siteId), columns: { clientId: true } });
    if (!site || site.clientId !== actor.clientId) return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const events = await eventsAfter(id, after);
  const live = run ? run.status === "queued" || run.status === "running" : proposal?.status === "applying";
  return NextResponse.json({ events, live }, { headers: { "cache-control": "no-store" } });
}
