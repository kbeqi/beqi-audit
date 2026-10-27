"use client";

import { btnSecondary } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">{error.message || "Unexpected error."}</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-ink-3">{error.digest}</p>}
      <button onClick={reset} className={`${btnSecondary} mt-4`}>
        Try again
      </button>
    </div>
  );
}
