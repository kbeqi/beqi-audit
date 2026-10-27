// JSON blobs for a run live in R2 under runs/<runId>/<name>.json so that
// Workflow steps can hand large results to each other without hitting the
// per-step return-size limit.

export async function putJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}

export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return (await obj.json()) as T;
}

export const runKey = (runId: string, name: string) => `runs/${runId}/${name}.json`;
