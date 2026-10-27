import { headers } from "next/headers";

// The app sits behind Cloudflare Access (Zero Trust). Access injects the
// authenticated user's email on every request; locally we fall back to a dev
// identity. See README for the Access setup.
export async function currentActor(): Promise<string> {
  const h = await headers();
  return h.get("cf-access-authenticated-user-email") ?? "dev@local";
}
