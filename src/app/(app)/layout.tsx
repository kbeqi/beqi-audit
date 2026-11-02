import Link from "next/link";
import { Nav } from "@/components/nav";
import { SubmitButton } from "@/components/submit-button";
import { Mark } from "@/components/brand";
import { signOut } from "@/app/auth-actions";
import { currentActorOrNull, isTeam, isUnprotected } from "@/lib/auth";
import { clientHeader, pendingFixCount, toApplyCount } from "@/lib/queries";
import { btnGhost, btnSm } from "@/components/ui";
import { ThemeSwitch } from "@/components/theme-switch";

export const dynamic = "force-dynamic";

// The signed-in shell: one top bar, no sidebar. The team sees Clients ·
// To apply · Team; a client user sees their own Home · Changes · Fixes ·
// AI answers with the client's name and domain beside the mark.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActorOrNull();
  const open = await isUnprotected();
  const team = isTeam(actor);
  const clientId = !team && actor?.clientId ? actor.clientId : null;
  const [count, header] = await Promise.all([actor ? (clientId ? pendingFixCount(clientId) : toApplyCount()) : Promise.resolve(0), clientId ? clientHeader(clientId) : Promise.resolve(null)]);

  if (!actor) return <main className="flex min-h-screen items-center justify-center p-6">{children}</main>;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 lg:px-8">
          <Link href={clientId ? `/clients/${clientId}` : "/"} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-ink">
            <Mark />
            Beqi Audit
          </Link>
          {header && (
            <div className="hidden items-center gap-2 text-sm sm:flex">
              <span aria-hidden className="h-5 w-px bg-line" />
              <span className="font-semibold text-ink">{header.client.name}</span>
              {header.siteHost && <span className="text-ink-3">{header.siteHost}</span>}
            </div>
          )}
          <div className="flex w-full min-w-0 items-center gap-3 sm:ml-auto sm:w-auto">
            <div className="min-w-0 flex-1 overflow-x-auto sm:flex-none">
              <Nav pendingFixes={count} clientId={clientId} />
            </div>
            <details className="relative">
              <summary aria-label="Account menu" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-line bg-surface-2 text-sm font-semibold text-ink">
                {(actor.name ?? actor.email).slice(0, 1).toUpperCase()}
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
                <div className="truncate font-medium text-ink" title={actor.email}>
                  {actor.via === "open" ? "No sign-in configured" : actor.name ?? actor.email}
                </div>
                {actor.name && actor.via !== "open" && <div className="truncate text-xs text-ink-3">{actor.email}</div>}
                <div className="mt-1 text-xs text-ink-3">{actor.role === "admin" ? "Admin" : actor.role === "client" ? "Client" : "Member"}</div>
                <div className="mt-3">
                  <ThemeSwitch />
                </div>
                {actor.via === "session" && (
                  <form action={signOut} className="mt-3">
                    <SubmitButton className={`${btnGhost} ${btnSm} w-full`} pendingLabel="…">
                      Sign out
                    </SubmitButton>
                  </form>
                )}
              </div>
            </details>
          </div>
        </div>
      </header>
      {open && (
        <div className="px-4 py-2 text-sm tone-warn">
          <strong>This deployment is open to anyone with the URL.</strong> Set <code className="font-mono">AUTH_MODE</code> to <code className="font-mono">app</code> in wrangler.jsonc to require sign-in.
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      <footer className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-ink-3 lg:px-8">{clientId ? "Beqi Audit · your site care hub, run by Beqi" : "Beqi Audit · internal tool"}</footer>
    </div>
  );
}
