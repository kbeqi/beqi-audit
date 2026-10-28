import { eq, max } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import type { RunEventKind } from "@/db/schema";
import { newId } from "@/lib/id";

export type EventSink = (kind: RunEventKind, title: string, detail?: Record<string, unknown>) => Promise<void>;

// Appends to the activity log of one agent stream (an audit run or a fix). Log
// failures never fail the run. Several pipeline steps each create a sink for
// the same stream, so numbering continues from what is already stored.
export function createEventSink(env: Pick<CloudflareEnv, "DB">, streamId: string): EventSink {
  const db = dbFromEnv(env);
  let seq: number | null = null;
  return async (kind, title, detail) => {
    if (seq === null) {
      try {
        const [row] = await db.select({ m: max(schema.runEvents.seq) }).from(schema.runEvents).where(eq(schema.runEvents.streamId, streamId));
        seq = row?.m ?? 0;
      } catch {
        seq = 0;
      }
    }
    seq += 1;
    try {
      await db.insert(schema.runEvents).values({ id: newId(), streamId, seq, kind, title: title.slice(0, 300), detail: detail ?? null });
    } catch (e) {
      console.warn("run_events insert failed", (e as Error).message);
    }
  };
}
