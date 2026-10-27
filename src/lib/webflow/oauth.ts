// Webflow OAuth 2.0 authorization-code flow.
// Docs: https://developers.webflow.com/data/reference/oauth-app

export const WEBFLOW_SCOPES = [
  "sites:read",
  "sites:write",
  "pages:read",
  "pages:write",
  "custom_code:read",
  "custom_code:write",
  "cms:read",
  "assets:read",
  "forms:read",
  "site_config:read",
  "site_config:write",
  "authorized_user:read",
].join(" ");

export function authorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL("https://webflow.com/oauth/authorize");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", WEBFLOW_SCOPES);
  u.searchParams.set("state", opts.state);
  return u.toString();
}

export async function exchangeCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ access_token: string; token_type: string; scope?: string }> {
  const res = await fetch("https://api.webflow.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Webflow token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; token_type: string; scope?: string };
}

// Webhook payloads are signed with HMAC-SHA256 of `${timestamp}:${body}` using the
// OAuth client secret. Reject anything older than 5 minutes.
export async function verifyWebhookSignature(opts: {
  clientSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
}): Promise<boolean> {
  if (!opts.timestamp || !opts.signature) return false;
  const age = Date.now() - Number(opts.timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > 5 * 60 * 1000) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${opts.timestamp}:${opts.rawBody}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, opts.signature.toLowerCase());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
