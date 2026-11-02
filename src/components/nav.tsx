"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item {
  href: string;
  label: string;
  match: (p: string) => boolean;
  count?: number;
}

// The team's three destinations. "To apply" is the cross-client queue of
// fixes a client or a team member approved and Beqi still has to apply.
function teamItems(toApply: number): Item[] {
  return [
    { href: "/", label: "Clients", match: (p) => p === "/" || p.startsWith("/clients") || p.startsWith("/runs/") || p.startsWith("/fixes/") },
    { href: "/fixes", label: "To apply", match: (p) => p === "/fixes", count: toApply },
    { href: "/team", label: "Team", match: (p) => p.startsWith("/team") },
  ];
}

// A client user's four destinations: the questions they come with.
function clientItems(clientId: string, waiting: number): Item[] {
  const base = `/clients/${clientId}`;
  return [
    { href: base, label: "Home", match: (p) => p === base || p.startsWith("/runs/") || p.startsWith(`${base}/audits`) },
    { href: `${base}/changes`, label: "Changes", match: (p) => p.startsWith(`${base}/changes`) },
    { href: `${base}/fixes`, label: "Fixes", match: (p) => p.startsWith(`${base}/fixes`) || p.startsWith("/fixes/"), count: waiting },
    { href: `${base}/ai`, label: "AI answers", match: (p) => p.startsWith(`${base}/ai`) },
  ];
}

export function Nav({ pendingFixes, clientId = null }: { pendingFixes: number; clientId?: string | null }) {
  const pathname = usePathname() ?? "/";
  const items = clientId ? clientItems(clientId, pendingFixes) : teamItems(pendingFixes);
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto">
      {items.map((it) => {
        const active = it.match(pathname);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-surface-2 font-semibold text-ink" : "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
          >
            {it.label}
            {it.count ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-bg px-1.5 text-[12px] font-semibold text-accent-ink num">{it.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
