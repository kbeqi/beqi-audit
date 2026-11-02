// The Beqi mark: the brand polygon on an accent tile. The same shape is the
// favicon (src/app/icon.svg) and the sidebar/report logo.
export const BEQI_MARK_PATH = "M33.9 9.4 24.4 0 0 0 9.4 9.4 0 18.9 9.4 28.3 0 37.8 24.4 37.8 33.9 28.3 24.4 18.9 33.9 9.4Z";

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <rect width="48" height="48" rx={size >= 40 ? 11 : 12} fill="var(--accent)" />
      {/* 33.9 x 37.8 artwork scaled to 24 x 26.8 and centred */}
      <g transform="translate(12 10.6) scale(0.708)">
        <path d={BEQI_MARK_PATH} fill="#fff" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight text-ink ${className}`}>
      <Mark size={size} />
      Beqi Audit
    </span>
  );
}
