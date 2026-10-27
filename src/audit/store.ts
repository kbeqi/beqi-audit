// JSON blobs for a run live in Workers KV under runs/<runId>/<name>.json so that
// Workflow steps can hand large results to each other without hitting the
// per-step return-size limit. KV values are capped at 25 MiB, which is far above
// a 200-page crawl; expire artifacts after 90 days to keep the namespace small.

const ARTIFACT_TTL_SECONDS = 90 * 24 * 60 * 60;

export async function putJson(store: KVNamespace, key: string, value: unknown): Promise<void> {
  await store.put(key, JSON.stringify(value), { expirationTtl: ARTIFACT_TTL_SECONDS });
}

export async function getJson<T>(store: KVNamespace, key: string): Promise<T | null> {
  return (await store.get<T>(key, "json")) ?? null;
}

export const runKey = (runId: string, name: string) => `runs/${runId}/${name}.json`;
