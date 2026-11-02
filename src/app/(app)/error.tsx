"use client";

import Link from "next/link";
import { btnPrimary, btnSecondary } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const hidden = /Minified React error #441|An error occurred in the Server Components render/.test(error.message ?? "");
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">
        {hidden
          ? "The server hit an error while handling this action. If it was a fix or an audit, it may still have gone through — check the page you came from before retrying."
          : error.message || "Unexpected error."}
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-3">ref {error.digest}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={reset} className={btnPrimary}>
          Try again
        </button>
        <Link href="/" className={btnSecondary}>
          Back to portfolio
        </Link>
      </div>
    </div>
  );
}
