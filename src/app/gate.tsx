import { notFound, redirect } from "next/navigation";
import { currentActorOrNull, isTeam, type Actor } from "@/lib/auth";

// Call at the top of every page that needs a signed-in user. Sends visitors to
// the sign-in page and brings them back afterwards.
export async function requireSignedIn(next: string): Promise<Actor> {
  const actor = await currentActorOrNull();
  if (!actor) redirect(`/login?next=${encodeURIComponent(next)}`);
  return actor;
}

// Pages that only the Beqi team may see (portfolio, all clients, team, cross-client lists).
// A client user is sent to their own hub instead.
export async function requireTeam(next: string): Promise<Actor> {
  const actor = await requireSignedIn(next);
  if (!isTeam(actor)) redirect(actor.clientId ? `/clients/${actor.clientId}` : "/login");
  return actor;
}

// A client's pages: the team sees every client; a client user only their own.
export async function requireClientAccess(clientId: string, next: string): Promise<Actor> {
  const actor = await requireSignedIn(next);
  if (!isTeam(actor) && actor.clientId !== clientId) notFound();
  return actor;
}

// For generateMetadata: a page title must not name a client the viewer may not see.
export async function canSeeClient(clientId: string | null | undefined): Promise<boolean> {
  const actor = await currentActorOrNull();
  return !!actor && !!clientId && (isTeam(actor) || actor.clientId === clientId);
}
