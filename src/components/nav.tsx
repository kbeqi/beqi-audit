"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Portfolio", match: (p: string) => p === "/" },
  { href: "/clients", label: "Clients", match: (p: string) => p.startsWith("/clients") || p.startsWith("/sites") || p.startsWith("/runs") || p.startsWith("/fixes") },
  { href: "/team", label: "Team", match: (p: string) => p.startsWith("/team"), team: true },
];

export function Nav({ pendingFixes, showTeam = true }: { pendingFixes: number; showTeam?: boolean }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
      {ITEMS.filter((it) => !it.team || showTeam).map((it) => {
        const active = it.match(pathname);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
          >
            {it.label}
            {it.href === "/fixes" && pendingFixes > 0 && <span className="rounded-md px-1.5 text-[11px] font-semibold num tone-warn">{pendingFixes}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
