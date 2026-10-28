import { redirect } from "next/navigation";
import { currentActorOrNull } from "@/lib/auth";

// Call at the top of every page that needs a signed-in user. Sends visitors to
// the sign-in page and brings them back afterwards.
export async function requireSignedIn(next: string): Promise<void> {
  if (!(await currentActorOrNull())) redirect(`/login?next=${encodeURIComponent(next)}`);
}
