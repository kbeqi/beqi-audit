import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/components/nav";
import { currentActorOrNull, isUnprotected } from "@/lib/auth";
import { pendingFixCount } from "@/lib/queries";

export const metadata: Metadata = {
  title: { default: "Beqi Audit", template: "%s · Beqi Audit" },
  description: "Claude-run audits and fixes for Beqi's Webflow client sites",
};

export const dynamic = "force-dynamic";

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="20" height="20" rx="6" fill="var(--accent)" />
      <path d="M6.5 11.5l3 3 6-7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActorOrNull();
  const open = await isUnprotected();
  const pending = actor ? await pendingFixCount() : 0;

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {actor ? (
          <div className="flex min-h-screen flex-col lg:flex-row">
            <aside className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface px-4 py-3 lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
              <Link href="/" className="flex items-center gap-2 px-1 font-semibold tracking-tight text-ink">
                <Mark />
                Beqi Audit
              </Link>
              <Nav pendingFixes={pending} />
              <div className="mt-auto hidden px-1 text-xs text-ink-3 lg:block">
                <div className="truncate" title={actor}>
                  {actor === "open-access" ? "No login configured" : actor}
                </div>
                <div className="mt-1">Audits by Claude · Webflow MCP</div>
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              {open && (
                <div className="px-4 py-2 text-sm tone-warn">
                  <strong>This deployment is open to anyone with the URL.</strong> Put Cloudflare Access in front of it and set <code className="font-mono">AUTH_MODE</code> to <code className="font-mono">access</code> in wrangler.jsonc.
                </div>
              )}
              <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">{children}</main>
              <footer className="px-4 py-4 text-xs text-ink-3 lg:px-8">Beqi Audit · internal tool</footer>
            </div>
          </div>
        ) : (
          <main className="flex min-h-screen items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-line bg-surface p-6 text-center">
              <div className="mx-auto mb-3 flex justify-center">
                <Mark />
              </div>
              <h1 className="text-lg font-semibold text-ink">Sign in required</h1>
              <p className="mt-2 text-sm text-ink-2">This app is protected by Cloudflare Access. Open it through your Access login to continue.</p>
            </div>
          </main>
        )}
      </body>
    </html>
  );
}
