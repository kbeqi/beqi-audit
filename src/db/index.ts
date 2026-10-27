import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

export function dbFromEnv(env: Pick<CloudflareEnv, "DB">): Db {
  return drizzle(env.DB, { schema });
}

// For Next.js server components, route handlers and server actions.
export async function getDb(): Promise<Db> {
  const { env } = await getCloudflareContext({ async: true });
  return dbFromEnv(env);
}

export { schema };
