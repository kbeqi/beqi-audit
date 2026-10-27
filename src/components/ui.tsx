import type { Severity } from "@/db/schema";

export function ScoreBadge({ score, size = "md" }: { score: number | null | undefined; size?: "md" | "lg" }) {
  const cls = score == null ? "bg-zinc-200 text-zinc-600" : score >= 90 ? "bg-emerald-100 text-emerald-800" : score >= 70 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  const dims = size === "lg" ? "h-14 w-14 text-xl" : "h-9 w-9 text-sm";
  return <span className={`inline-flex ${dims} items-center justify-center rounded-full font-semibold tabular-nums ${cls}`}>{score ?? "–"}</span>;
}

export function Delta({ now, before }: { now: number | null | undefined; before: number | null | undefined }) {
  if (now == null || before == null) return <span className="text-xs text-zinc-400">—</span>;
  const d = now - before;
  if (d === 0) return <span className="text-xs text-zinc-500">±0</span>;
  return <span className={`text-xs font-medium ${d > 0 ? "text-emerald-700" : "text-red-700"}`}>{d > 0 ? `+${d}` : d}</span>;
}

const SEV: Record<Severity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-sky-100 text-sky-800",
  info: "bg-zinc-100 text-zinc-700",
};

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${SEV[severity]}`}>{severity}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const cls =
    status === "complete" ? "bg-emerald-100 text-emerald-800" : status === "failed" ? "bg-red-100 text-red-800" : status === "running" ? "bg-sky-100 text-sky-800" : "bg-zinc-100 text-zinc-700";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${cls}`}>{status}</span>;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-zinc-200 bg-white p-4 ${className}`}>{children}</div>;
}

export const inputCls = "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:border-zinc-500 focus:outline-none";
export const buttonCls = "inline-flex items-center rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
export const buttonSecondaryCls = "inline-flex items-center rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50";
