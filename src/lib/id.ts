// Sortable, URL-safe ids: 10 chars of base36 time + 16 random chars.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(): string {
  const time = Date.now().toString(36).padStart(10, "0");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % 36];
  return time + rand;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function nowIso(): string {
  return new Date().toISOString();
}
