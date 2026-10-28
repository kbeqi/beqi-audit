import { dbFromEnv, schema } from "@/db";
import type { RunEventKind } from "@/db/schema";
import { newId } from "@/lib/id";

export type EventSink = (kind: RunEventKind, title: string, detail?: Record<string, unknown>) => Promise<void>;

// Appends to the activity log of one agent stream (an audit run or a fix). Log
// failures never fail the run.
export function createEventSink(env: Pick<CloudflareEnv, "DB">, streamId: string): EventSink {
  const db = dbFromEnv(env);
  let seq = 0;
  return async (kind, title, detail) => {
    seq += 1;
    try {
      await db.insert(schema.runEvents).values({ id: newId(), streamId, seq, kind, title: title.slice(0, 300), detail: detail ?? null });
    } catch (e) {
      console.warn("run_events insert failed", (e as Error).message);
    }
  };
}
