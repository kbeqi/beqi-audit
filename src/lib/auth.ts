import { headers } from "next/headers";
import { getEnv } from "./env";

// The app sits behind Cloudflare Access (Zero Trust), which injects the
// authenticated user's email on every request. With AUTH_MODE=access the app
// fails closed when that header is missing; AUTH_MODE=open serves everyone
// (bring-up only) and the UI shows a warning banner. Local dev always works.

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in. This app is protected by Cloudflare Access.");
  }
}

export function isLocalDev(env: Pick<CloudflareEnv, "APP_URL">): boolean {
  return !env.APP_URL || /localhost|127\.0\.0\.1/.test(env.APP_URL);
}

export async function currentActorOrNull(): Promise<string | null> {
  const h = await headers();
  const email = h.get("cf-access-authenticated-user-email");
  if (email) return email;
  const env = await getEnv();
  if (isLocalDev(env)) return "dev@local";
  if (env.AUTH_MODE === "open") return "open-access";
  return null;
}

export async function currentActor(): Promise<string> {
  const actor = await currentActorOrNull();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

// True when the deployment is reachable without any login.
export async function isUnprotected(): Promise<boolean> {
  const env = await getEnv();
  const h = await headers();
  return !isLocalDev(env) && env.AUTH_MODE === "open" && !h.get("cf-access-authenticated-user-email");
}
