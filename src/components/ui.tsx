import Link from "next/link";
import type { ProposalRisk, ProposalStatus, RunStatus, Severity } from "@/db/schema";

// ---- tones ------------------------------------------------------------------

export type Tone = "good" | "warn" | "serious" | "critical" | "neutral" | "accent";

export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "neutral";
  if (score >= 90) return "good";
  if (score >= 70) return "warn";
  return "critical";
}

const SEVERITY_TONE: Record<Severity, Tone> = { critical: "critical", high: "serious", medium: "warn", low: "accent", info: "neutral" };

// ---- figures ----------------------------------------------------------------

// A meter: the arc carries the score's state, the track is a light step of the
// same hue. The number stays in ink, proportional figures.
export function ScoreRing({ score, size = "md", label }: { score: number | null | undefined; size?: "sm" | "md" | "lg" | "xl"; label?: string }) {
  const px = size === "xl" ? 128 : size === "lg" ? 88 : size === "md" ? 48 : 36;
  const stroke = size === "xl" ? 9 : size === "lg" ? 7 : size === "md" ? 5 : 4;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const font = size === "xl" ? 48 : size === "lg" ? 30 : size === "md" ? 15 : 12;
  const color = tone === "neutral" ? "var(--line-2)" : `var(--${tone})`;
  return (
    <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} role="img" aria-label={label ?? (score == null ? "No score yet" : `Score ${score} out of 100`)} className="shrink-0">
      <circle cx={px / 2} cy={px / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: tone === "neutral" ? "var(--surface-2)" : `color-mix(in oklab, ${color} 20%, var(--surface))` }} />
      {score != null && (
        <circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${px / 2} ${px / 2})`}
          style={{ stroke: color }}
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={font} fontWeight={600} fill="var(--ink)">
        {score ?? "–"}
      </text>
    </svg>
  );
}

// 2px single-series line, history in the de-emphasis hue, current value as an
// accent end-dot with a surface ring. Values are 0-100 scores.
export function Sparkline({ values, width = 96, height = 28, title }: { values: (number | null)[]; width?: number; height?: number; title?: string }) {
  const pts = values.filter((v): v is number => v != null);
  if (pts.length < 2) return <span className="text-xs text-ink-3">—</span>;
  const pad = 5;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - (Math.max(0, Math.min(100, v)) / 100) * (height - pad * 2);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title ?? `Score trend: ${pts.join(", ")}`} className="shrink-0">
      <title>{title ?? `Scores: ${pts.join(" → ")}`}</title>
      <path d={d} fill="none" stroke="var(--line-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(pts[last])} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

export function Delta({ now, before, suffix = "" }: { now: number | null | undefined; before: number | null | undefined; suffix?: string }) {
  if (now == null || before == null) return <span className="text-xs text-ink-3">—</span>;
  const d = now - before;
  if (d === 0) return <span className="text-xs text-ink-3">±0{suffix}</span>;
  const up = d > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-up" : "text-critical"}`} aria-label={`${up ? "up" : "down"} ${Math.abs(d)} vs previous`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(d)}
      {suffix}
    </span>
  );
}

export function StatTile({ label, value, hint, delta, children }: { label: string; value: React.ReactNode; hint?: string; delta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold leading-none text-ink">{value}</div>
        {delta}
        {children}
      </div>
      {hint && <div className="mt-2 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

// ---- pills ------------------------------------------------------------------

function Pill({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide tone-${tone}`}>
      {children}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <Pill tone={SEVERITY_TONE[severity]}>{severity}</Pill>;
}

export function StatusPill({ status }: { status: RunStatus | string }) {
  const tone: Tone = status === "complete" ? "good" : status === "failed" ? "critical" : status === "running" ? "accent" : "neutral";
  return (
    <Pill tone={tone}>
      {status === "running" && <span aria-hidden className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" />}
      {status}
    </Pill>
  );
}

export function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  const tone: Tone = status === "applied" ? "good" : status === "failed" ? "critical" : status === "rejected" ? "neutral" : status === "applying" ? "accent" : status === "approved" ? "warn" : "neutral";
  const label = status === "proposed" ? "needs review" : status;
  return (
    <Pill tone={tone}>
      {status === "applying" && <span aria-hidden className="pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" />}
      {label}
    </Pill>
  );
}

export function RiskPill({ risk }: { risk: ProposalRisk | null | undefined }) {
  if (!risk) return null;
  const tone: Tone = risk === "high" ? "serious" : risk === "medium" ? "warn" : "neutral";
  return <Pill tone={tone} title="Risk of applying this change automatically">{risk} risk</Pill>;
}

export function CountPill({ n, tone, label }: { n: number; tone: Tone; label: string }) {
  if (!n) return null;
  return (
    <Pill tone={tone} title={`${n} ${label}`}>
      <span className="num">{n}</span> {label}
    </Pill>
  );
}

// ---- layout bits ------------------------------------------------------------

export function Card({ children, className = "", as: Tag = "section", id }: { children: React.ReactNode; className?: string; as?: "section" | "div" | "article"; id?: string }) {
  return (
    <Tag id={id} className={`rounded-xl border border-line bg-surface ${className}`}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, actions, count }: { title: string; description?: string; actions?: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          {title}
          {count != null && <span className="ml-1.5 text-xs font-medium text-ink-3 num">{count}</span>}
        </h2>
        {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-ink-3">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-1 text-sm text-ink-2">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-ink hover:underline">
              {it.label}
            </Link>
          ) : (
            <span className="text-ink-2">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {body && <p className="max-w-md text-sm text-ink-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <div className={`rounded-lg px-3.5 py-2.5 text-sm tone-${tone}`}>{children}</div>;
}

export function KeyValue({ items }: { items: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map((it) => (
        <div key={it.k} className="contents">
          <dt className="text-ink-3">{it.k}</dt>
          <dd className="min-w-0 break-words text-ink">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- controls ---------------------------------------------------------------

export const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = `${btn} bg-accent text-accent-ink hover:brightness-110`;
export const btnSecondary = `${btn} border border-line-2 bg-surface text-ink hover:bg-surface-2`;
export const btnGhost = `${btn} text-ink-2 hover:bg-surface-2 hover:text-ink`;
export const btnDanger = `${btn} border border-line-2 bg-surface text-critical hover:bg-surface-2`;
export const btnSm = "!px-2 !py-1 !text-xs";
export const inputCls = "w-full rounded-lg border border-line-2 bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";
export const labelCls = "mb-1 block text-xs font-medium text-ink-2";

// ---- formatting -------------------------------------------------------------

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return fmtDay(iso);
}

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
