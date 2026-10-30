"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RunEvent, RunEventKind } from "@/db/schema";

const GLYPH: Record<RunEventKind, { g: string; cls: string }> = {
  status: { g: "●", cls: "text-accent" },
  tool_call: { g: "⚙", cls: "text-ink-3" },
  tool_result: { g: "↩", cls: "text-ink-3" },
  fetch: { g: "⇣", cls: "text-ink-3" },
  text: { g: "✎", cls: "text-ink-3" },
  warning: { g: "⚠", cls: "text-serious-text" },
  error: { g: "✕", cls: "text-critical-text" },
  done: { g: "✓", cls: "text-good-text" },
};

export type Ev = Pick<RunEvent, "id" | "seq" | "kind" | "title" | "detail" | "createdAt">;

export interface Stream {
  events: Ev[];
  polling: boolean;
  // Milliseconds since startedAt, ticking once a second while live.
  elapsedMs: number | null;
}

// Polls an agent stream's events while it is live. When a terminal event
// arrives the server-rendered page data is refreshed too. One hook per page:
// the progress bar and the log share it.
export function useStream(streamId: string, initial: Ev[], live: boolean, startedAt?: string | null): Stream {
  const [events, setEvents] = useState<Ev[]>(initial);
  const [polling, setPolling] = useState(live);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const router = useRouter();
  const lastSeq = events.length ? events[events.length - 1].seq : 0;

  useEffect(() => {
    if (!polling || !startedAt) return;
    const t0 = new Date(startedAt).getTime();
    const tick = () => setElapsedMs(Math.max(0, Date.now() - t0));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [polling, startedAt]);

  // The header (status pill, timings) is server-rendered: refresh it when the
  // stream first produces events, every ~30 s while live, and at the end.
  const ticks = useRef(0);
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/streams/${streamId}/events?after=${lastSeq}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { events: Ev[]; live: boolean };
        if (cancelled) return;
        const first = data.events.length > 0 && lastSeq === 0;
        if (data.events.length) setEvents((prev) => [...prev, ...data.events]);
        ticks.current += 1;
        if (!data.live) {
          setPolling(false);
          router.refresh();
        } else if (first || ticks.current % 10 === 0) {
          router.refresh();
        }
      } catch {
        /* retry on the next tick */
      }
    };
    const id = setInterval(tick, 3000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [polling, lastSeq, streamId, router]);

  return { events, polling, elapsedMs };
}

function fmtClock(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Shows an agent stream's activity. Pass `stream` to share a poller with other
// components on the page; otherwise it polls on its own.
export function LiveLog({ streamId, initial, live, compact = false, startedAt, stream }: { streamId: string; initial: Ev[]; live: boolean; compact?: boolean; startedAt?: string | null; stream?: Stream }) {
  const own = useStream(streamId, initial, stream ? false : live, startedAt);
  const { events, polling, elapsedMs } = stream ?? own;
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (polling) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [events.length, polling]);

  const visible = compact ? events.filter((e) => e.kind !== "tool_result") : events;

  return (
    <div className={`${compact ? "max-h-72" : "max-h-[32rem]"} overflow-y-auto px-5 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`} aria-live="polite" role="region" aria-label="Agent activity log" tabIndex={0}>
      {visible.length === 0 && <p className="py-6 text-center text-sm text-ink-3">{polling ? "Waiting for the agent to start…" : "No activity recorded."}</p>}
      {visible.map((e) => {
        const g = GLYPH[e.kind] ?? GLYPH.text;
        const d = (e.detail ?? {}) as Record<string, unknown>;
        return (
          <div key={e.id} className="log-row">
            <span aria-hidden className={`${g.cls} text-center`}>
              {g.g}
            </span>
            <div className="min-w-0">
              <div className={`break-words ${e.kind === "text" ? "text-ink-2" : e.kind === "error" ? "text-critical-text" : "text-ink"}`}>{e.title}</div>
              {typeof d.url === "string" && e.kind !== "fetch" && <div className="truncate font-mono text-xs text-ink-3">{d.url}</div>}
              {e.kind === "done" && typeof d.costUsd === "number" && <div className="text-xs text-ink-3">Cost ${d.costUsd.toFixed(2)}</div>}
            </div>
            <time className="whitespace-nowrap text-xs text-ink-3 num" dateTime={e.createdAt}>
              {new Date(e.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })}
            </time>
          </div>
        );
      })}
      {polling && (
        <div className="log-row">
          <span aria-hidden className="pulse text-center text-accent">
            ●
          </span>
          <div className="text-ink-3">
            Working… <span className="num">{events.length}</span> steps so far
          </div>
          <span className="text-xs text-ink-3 num">{fmtClock(elapsedMs)}</span>
        </div>
      )}
      <div ref={bottom} />
    </div>
  );
}
