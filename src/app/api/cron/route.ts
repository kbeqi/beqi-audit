import { NextResponse } from "next/server";
import { getCtx } from "@/lib/env";
import { runScheduler } from "@/audit/scheduler";
import { currentActor } from "@/lib/auth";

// Manual scheduler tick for local testing; production uses the cron trigger in worker.ts.
export async function POST() {
  const { env } = await getCtx();
  const actor = await currentActor();
  const result = await runScheduler(env, new Date());
  return NextResponse.json({ ...result, actor });
}
