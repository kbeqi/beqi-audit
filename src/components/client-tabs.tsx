"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface ClientTabCounts {
  audits: number;
  pendingFixes: number;
  sites: number;
  running: boolean;
}

// Section pills inside one client, for the team (a client user has the same
// destinations in the top bar). The active one is marked for sighted users
// and assistive tech (aria-current).
export function ClientTabs({ clientId, counts, showSettings = true }: { clientId: string; counts: ClientTabCounts; showSettings?: boolean }) {
  const pathname = usePathname() ?? "";
  const base = `/clients/${clientId}`;
  const tabs = [
    { href: base, label: "Home", exact: true },
    { href: `${base}/changes`, label: "Changes" },
    { href: `${base}/fixes`, label: "Fixes", badge: counts.pendingFixes || undefined, warn: counts.pendingFixes > 0 },
    { href: `${base}/ai`, label: "AI answers" },
    { href: `${base}/audits`, label: "Audits", badge: counts.running ? "live" : undefined, live: counts.running },
    ...(showSettings ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];
  return (
    <nav aria-label="Client sections" className="flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${active ? "bg-surface-2 font-semibold text-ink" : "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
          >
            {t.label}
            {t.badge !== undefined && (
              <span className={`rounded-md px-1.5 text-[11px] font-semibold num ${t.live ? "tone-accent" : t.warn ? "tone-warn" : "tone-neutral"}`}>
                {t.live && <span aria-hidden className="pulse mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent-bg" />}
                {t.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
