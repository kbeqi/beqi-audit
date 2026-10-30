"use client";

import { useEffect, useState } from "react";
import type { CategoryKey } from "@/db/schema";
import { scoreTone } from "./ui";

export interface StripItem {
  cat: CategoryKey;
  label: string;
  score: number | null | undefined;
  count: number;
  // AI sample: text instead of a score.
  note?: string;
}

// Sticky row of small score gauges, one per area, each an anchor to its
// section (the Lighthouse pattern). The area in view is underlined.
export function CategoryStrip({ items }: { items: StripItem[] }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const sections = items.map((i) => document.getElementById(`area-${i.cat}`)).filter((el): el is HTMLElement => !!el);
    if (!sections.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace("area-", ""));
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [items]);

  return (
    <nav aria-label="Areas" className="sticky top-0 z-10 -mx-4 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:-mx-8 lg:px-8">
      <ul className="flex gap-1 overflow-x-auto">
        {items.map((i) => {
          const tone = scoreTone(i.score);
          const color = i.note !== undefined ? "var(--line-2)" : tone === "neutral" ? "var(--line-2)" : `var(--${tone})`;
          const pct = i.score == null ? 0 : Math.max(0, Math.min(100, i.score)) / 100;
          const r = 15;
          const c = 2 * Math.PI * r;
          const isActive = active === i.cat;
          return (
            <li key={i.cat} className="shrink-0">
              <a
                href={`#area-${i.cat}`}
                aria-current={isActive ? "location" : undefined}
                className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-2 ${isActive ? "bg-surface-2 text-ink" : "text-ink-2"}`}
                title={i.count === 0 ? `${i.label}: nothing found` : `${i.label}: ${i.count} finding${i.count === 1 ? "" : "s"}`}
              >
                <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" className="shrink-0">
                  <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" style={{ stroke: i.note !== undefined ? "var(--surface-2)" : `color-mix(in oklab, ${color} 22%, var(--surface))` }} />
                  {i.score != null && <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 18 18)" style={{ stroke: color }} />}
                  <text x="18" y="18" textAnchor="middle" dominantBaseline="central" fontSize={i.note !== undefined ? 9 : 11} fontWeight="600" fill="var(--ink)">
                    {i.note !== undefined ? "AI" : (i.score ?? "–")}
                  </text>
                </svg>
                <span className="whitespace-nowrap">{i.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
