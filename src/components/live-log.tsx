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
  warning: { g: "⚠", cls: "text-serious" },
  error: { g: "✕", cls: "text-critical" },
  done: { g: "✓", cls: "text-good" },
};

type Ev = Pick<RunEvent, "id" | "seq" | "kind" | "title" | "detail" | "createdAt">;

// Shows an agent stream's activity and keeps polling while it is live. When a
// terminal event arrives the server-rendered page data is refreshed too.
export function LiveLog({ streamId, initial, live, compact = false }: { streamId: string; initial: Ev[]; live: boolean; compact?: boolean }) {
  const [events, setEvents] = useState<Ev[]>(initial);
  const [polling, setPolling] = useState(live);
  const router = useRouter();
  const bottom = useRef<HTMLDivElement>(null);
  const lastSeq = events.length ? events[events.length - 1].seq : 0;

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
        const terminal = data.events.some((e) => e.kind === "done" || e.kind === "error");
        ticks.current += 1;
        if (terminal || !data.live) {
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

  useEffect(() => {
    if (polling) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [events.length, polling]);

  const visible = compact ? events.filter((e) => e.kind !== "tool_result") : events;

  return (
    <div className={`${compact ? "max-h-72" : "max-h-[32rem]"} overflow-y-auto px-5 py-2`} aria-live="polite">
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
              <div className={`break-words ${e.kind === "text" ? "text-ink-2" : e.kind === "error" ? "text-critical" : "text-ink"}`}>{e.title}</div>
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
          <div className="text-ink-3">Working…</div>
          <span />
        </div>
      )}
      <div ref={bottom} />
    </div>
  );
}
