import Link from "next/link";
import { Nav } from "@/components/nav";
import { SubmitButton } from "@/components/submit-button";
import { Mark } from "@/components/brand";
import { signOut } from "@/app/auth-actions";
import { currentActorOrNull, isUnprotected } from "@/lib/auth";
import { pendingFixCount } from "@/lib/queries";
import { btnGhost, btnSm } from "@/components/ui";
import { ThemeSwitch } from "@/components/theme-switch";

export const dynamic = "force-dynamic";

// The signed-in shell. Pages under (app) redirect to /login themselves when
// there is no session; this layout only renders the chrome.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActorOrNull();
  const open = await isUnprotected();
  const pending = actor ? await pendingFixCount() : 0;

  if (!actor) return <main className="flex min-h-screen items-center justify-center p-6">{children}</main>;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface px-4 py-3 lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
        <Link href="/" className="flex items-center gap-2 px-1 font-semibold tracking-tight text-ink">
          <Mark />
          Beqi Audit
        </Link>
        <Nav pendingFixes={pending} showTeam />
        <div className="mt-auto hidden px-1 text-xs text-ink-3 lg:block">
          <div className="mb-3">
            <ThemeSwitch />
          </div>
          <div className="truncate font-medium text-ink-2" title={actor.email}>
            {actor.via === "open" ? "No sign-in configured" : actor.name ?? actor.email}
          </div>
          {actor.name && actor.via !== "open" && <div className="truncate">{actor.email}</div>}
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>{actor.role === "admin" ? "Admin" : "Member"}</span>
            {actor.via === "session" && (
              <form action={signOut}>
                <SubmitButton className={`${btnGhost} ${btnSm}`} pendingLabel="…">
                  Sign out
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {open && (
          <div className="px-4 py-2 text-sm tone-warn">
            <strong>This deployment is open to anyone with the URL.</strong> Set <code className="font-mono">AUTH_MODE</code> to <code className="font-mono">app</code> in wrangler.jsonc to require sign-in.
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">{children}</main>
        <footer className="px-4 py-4 text-xs text-ink-3 lg:px-8">Beqi Audit · internal tool</footer>
      </div>
    </div>
  );
}
