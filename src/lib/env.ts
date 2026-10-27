import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

export async function getCtx() {
  return getCloudflareContext({ async: true });
}

export function appUrl(env: CloudflareEnv, req?: Request): string {
  if (env.APP_URL && !env.APP_URL.includes("localhost")) return env.APP_URL.replace(/\/$/, "");
  if (req) return new URL(req.url).origin;
  return (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
