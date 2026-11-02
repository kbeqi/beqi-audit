"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TEAM_ITEMS = [
  { href: "/", label: "Portfolio", match: (p: string) => p === "/" },
  { href: "/clients", label: "Clients", match: (p: string) => p.startsWith("/clients") || p.startsWith("/sites") || p.startsWith("/runs") || p.startsWith("/fixes") },
  { href: "/team", label: "Team", match: (p: string) => p.startsWith("/team"), team: true },
];

// A client user gets their own hub as the only destination; its tabs do the rest.
function clientItems(clientId: string) {
  const base = `/clients/${clientId}`;
  return [
    { href: base, label: "Overview", match: (p: string) => p === base },
    { href: `${base}/audits`, label: "Audits", match: (p: string) => p.startsWith(`${base}/audits`) || p.startsWith("/runs") },
    { href: `${base}/fixes`, label: "Fixes", match: (p: string) => p.startsWith(`${base}/fixes`) || p.startsWith("/fixes") },
    { href: `${base}/ai`, label: "AI answers", match: (p: string) => p.startsWith(`${base}/ai`) },
  ];
}

export function Nav({ pendingFixes, showTeam = true, clientId = null }: { pendingFixes: number; showTeam?: boolean; clientId?: string | null }) {
  const pathname = usePathname() ?? "/";
  const items = clientId ? clientItems(clientId) : TEAM_ITEMS.filter((it) => !("team" in it) || !it.team || showTeam);
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
      {items.map((it) => {
        const active = it.match(pathname);
        const showBadge = pendingFixes > 0 && it.label === "Fixes";
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
          >
            {it.label}
            {showBadge && <span className="rounded-md px-1.5 text-[11px] font-semibold num tone-warn">{pendingFixes}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
