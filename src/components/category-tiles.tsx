"use client";

import type { CategoryKey } from "@/db/schema";
import { Delta, scoreTone } from "./ui";

export interface CategoryTile {
  cat: CategoryKey;
  label: string;
  hint: string;
  score: number | null | undefined;
  before?: number | null;
  count: number;
  // For the AI sample: "5/20 mentioned" instead of a score.
  note?: string;
}

// Opens the matching section and scrolls to it. The sections are <details>
// with id "area-<cat>" (see CategorySections).
function jump(cat: CategoryKey) {
  const el = document.getElementById(`area-${cat}`) as HTMLDetailsElement | null;
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  const summary = el.querySelector("summary") as HTMLElement | null;
  summary?.focus({ preventScroll: true });
}

export function CategoryTiles({ tiles }: { tiles: CategoryTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="list" aria-label="Scores by area">
      {tiles.map((t) => {
        const tone = scoreTone(t.score);
        return (
          <a
            key={t.cat}
            role="listitem"
            href={`#area-${t.cat}`}
            onClick={(e) => {
              e.preventDefault();
              jump(t.cat);
            }}
            className="block rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-accent hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            title={`Open the ${t.label} section`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs font-medium text-ink">{t.label}</div>
              {t.before !== undefined && t.note === undefined && <Delta now={t.score} before={t.before} />}
            </div>
            <div className="truncate text-[11px] text-ink-3">{t.hint}</div>
            <div className="mt-2 flex items-end justify-between gap-2">
              {t.note !== undefined ? (
                <div className="text-sm font-semibold text-ink">{t.note}</div>
              ) : (
                <div className={`num text-2xl font-semibold leading-none ${tone === "critical" ? "text-critical-text" : "text-ink"}`}>{t.score ?? "–"}</div>
              )}
              <div className="text-xs text-ink-3 num">{t.count === 0 ? <span className="font-medium text-good-text">Nothing found</span> : `${t.count} finding${t.count === 1 ? "" : "s"}`}</div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
