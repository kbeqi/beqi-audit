import { Wordmark } from "@/components/brand";

export const dynamic = "force-dynamic";

// Pages anyone can open: sign-in and shared reports. No navigation, no
// session required, nothing internal.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 lg:px-6">
          <Wordmark />
          <a href="https://beqi.co" className="text-xs text-ink-3 hover:text-ink" target="_blank" rel="noreferrer">
            beqi.co
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 lg:px-6">{children}</main>
      <footer className="px-4 py-6 text-center text-xs text-ink-3">Beqi Audit · Webflow site audits by Beqi</footer>
    </div>
  );
}
