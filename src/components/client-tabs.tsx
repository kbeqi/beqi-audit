"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface ClientTabCounts {
  audits: number;
  pendingFixes: number;
  sites: number;
  running: boolean;
}

// Section navigation inside one client. The active tab is marked for both
// sighted users and assistive tech (aria-current).
export function ClientTabs({ clientId, counts }: { clientId: string; counts: ClientTabCounts }) {
  const pathname = usePathname() ?? "";
  const base = `/clients/${clientId}`;
  const tabs = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/audits`, label: "Audits", badge: counts.running ? "live" : counts.audits || undefined, live: counts.running },
    { href: `${base}/fixes`, label: "Fixes", badge: counts.pendingFixes || undefined, warn: counts.pendingFixes > 0 },
    { href: `${base}/sites`, label: "Sites", badge: counts.sites || undefined },
    { href: `${base}/settings`, label: "Settings" },
  ];
  return (
    <nav aria-label="Client sections" className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active ? "border-accent text-ink" : "border-transparent text-ink-2 hover:border-line-2 hover:text-ink"}`}
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
