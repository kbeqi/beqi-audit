"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Portfolio", match: (p: string) => p === "/" },
  { href: "/clients", label: "Clients", match: (p: string) => p.startsWith("/clients") || p.startsWith("/sites") },
  { href: "/fixes", label: "Fixes", match: (p: string) => p.startsWith("/fixes") },
  { href: "/runs", label: "Audits", match: (p: string) => p.startsWith("/runs") },
];

export function Nav({ pendingFixes }: { pendingFixes: number }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
      {ITEMS.map((it) => {
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
