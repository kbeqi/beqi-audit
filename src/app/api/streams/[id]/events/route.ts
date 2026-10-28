import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { currentActorOrNull } from "@/lib/auth";
import { eventsAfter } from "@/lib/queries";

// GET /api/streams/<runId|proposalId>/events?after=<seq>
// Polled by the live activity log. `live` tells the client whether to keep polling.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentActorOrNull())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const events = await eventsAfter(id, after);
  const db = await getDb();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, id), columns: { status: true } });
  let live = false;
  if (run) live = run.status === "queued" || run.status === "running";
  else {
    const proposal = await db.query.fixProposals.findFirst({ where: eq(schema.fixProposals.id, id), columns: { status: true } });
    live = proposal?.status === "applying";
  }
  return NextResponse.json({ events, live }, { headers: { "cache-control": "no-store" } });
}
