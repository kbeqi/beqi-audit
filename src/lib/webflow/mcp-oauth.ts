// OAuth against Webflow's hosted MCP server, using the MCP SDK's client auth
// helper: metadata discovery, dynamic client registration (RFC 7591), PKCE,
// code exchange and refresh. No Webflow Marketplace app is involved; the app
// registers itself with the MCP server the first time and reuses that
// registration (cached in KV) for later workspaces.

import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { eq } from "drizzle-orm";
import { dbFromEnv, schema } from "@/db";
import type { WebflowConnection } from "@/db/schema";
import { sha256Hex } from "@/lib/id";

// What the authorize route stores in a cookie between redirect and callback.
export interface PendingAuth {
  clientId: string;
  state: string;
  codeVerifier: string;
  serverUrl: string;
  redirectUri: string;
  mcpClientId: string | null;
  mcpClientSecret: string | null;
}

interface ProviderState {
  clientInfo?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  redirectUrl?: URL;
}

// One registered OAuth client per connection. Webflow's MCP server keeps one
// active grant per user and client, so when every workspace shared a single
// registration, authorizing a second workspace silently invalidated the
// first one's token ("Grant not found" on the next refresh). A distinct
// client id per connection keeps each grant independent.
function clientMetadata(redirectUri: string, label?: string): OAuthClientMetadata {
  return {
    client_name: label ? `Beqi Audit (${label})` : "Beqi Audit",
    client_uri: "https://beqi.co",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

// The SDK drives the flow through this interface; we only capture what it
// produces (registration, verifier, redirect URL, tokens) instead of acting on it.
function makeProvider(opts: {
  redirectUri: string;
  state: ProviderState;
  stateValue: () => string;
  label?: string;
  onClientInfo?: (info: OAuthClientInformationMixed) => Promise<void>;
}): OAuthClientProvider {
  const { redirectUri, state } = opts;
  return {
    get redirectUrl() {
      return redirectUri;
    },
    get clientMetadata() {
      return clientMetadata(redirectUri, opts.label);
    },
    state: () => opts.stateValue(),
    clientInformation: () => state.clientInfo,
    saveClientInformation: async (info) => {
      state.clientInfo = info;
      await opts.onClientInfo?.(info);
    },
    tokens: () => state.tokens,
    saveTokens: (tokens) => {
      state.tokens = tokens;
    },
    redirectToAuthorization: (url) => {
      state.redirectUrl = url;
    },
    saveCodeVerifier: (verifier) => {
      state.verifier = verifier;
    },
    codeVerifier: () => {
      if (!state.verifier) throw new Error("PKCE verifier missing");
      return state.verifier;
    },
  };
}

export async function beginMcpAuthorization(
  env: Pick<CloudflareEnv, "WEBFLOW_MCP_URL">,
  opts: { clientId: string; redirectUri: string },
): Promise<{ authorizationUrl: string; pending: PendingAuth }> {
  const serverUrl = env.WEBFLOW_MCP_URL;
  // No cached registration on purpose: a fresh client per authorization.
  const st: ProviderState = {};
  const stateValue = `${opts.clientId}.${crypto.randomUUID().replace(/-/g, "")}`;
  const label = `${opts.clientId.slice(-6)}-${(await sha256Hex(stateValue)).slice(0, 6)}`;
  const provider = makeProvider({ redirectUri: opts.redirectUri, state: st, stateValue: () => stateValue, label });
  const result = await auth(provider, { serverUrl });
  if (result !== "REDIRECT" || !st.redirectUrl || !st.verifier) {
    throw new Error("Webflow's MCP server did not start an authorization flow");
  }
  return {
    authorizationUrl: st.redirectUrl.toString(),
    pending: {
      clientId: opts.clientId,
      state: stateValue,
      codeVerifier: st.verifier,
      serverUrl,
      redirectUri: opts.redirectUri,
      mcpClientId: st.clientInfo?.client_id ?? null,
      mcpClientSecret: st.clientInfo?.client_secret ?? null,
    },
  };
}

export async function completeMcpAuthorization(opts: { pending: PendingAuth; code: string }): Promise<{ tokens: OAuthTokens; clientInfo: OAuthClientInformationMixed | undefined }> {
  const { pending } = opts;
  const st: ProviderState = {
    verifier: pending.codeVerifier,
    clientInfo: pending.mcpClientId
      ? { client_id: pending.mcpClientId, ...(pending.mcpClientSecret ? { client_secret: pending.mcpClientSecret } : {}), ...clientMetadata(pending.redirectUri) }
      : undefined,
  };
  const provider = makeProvider({ redirectUri: pending.redirectUri, state: st, stateValue: () => pending.state });
  const result = await auth(provider, { serverUrl: pending.serverUrl, authorizationCode: opts.code });
  if (result !== "AUTHORIZED" || !st.tokens) throw new Error("Token exchange with Webflow's MCP server failed");
  return { tokens: st.tokens, clientInfo: st.clientInfo };
}

export function expiresAtFrom(tokens: OAuthTokens): string | null {
  return tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
}

// An audit's agent step can run for up to 30 minutes on one token, so a token
// is refreshed when it would not survive that. Webflow tokens last an hour.
const REFRESH_WHEN_LESS_THAN_MS = 45 * 60 * 1000;

// Refreshes the connection's access token when it would expire during a run.
// Returns the connection to use (updated in place in D1 when a refresh
// happened). Refresh tokens rotate, so when two runs share a connection the
// row is re-read first: if another run just refreshed it, that token is used.
export async function ensureFreshConnection(
  env: Pick<CloudflareEnv, "DB" | "WEBFLOW_MCP_URL" | "APP_URL">,
  connection: WebflowConnection,
): Promise<WebflowConnection> {
  if (connection.authKind !== "mcp_oauth") return connection;
  if (!connection.expiresAt || !connection.refreshToken) return connection;
  const fresh = (iso: string | null) => !!iso && new Date(iso).getTime() - Date.now() > REFRESH_WHEN_LESS_THAN_MS;
  if (fresh(connection.expiresAt)) return connection;
  const current = await dbFromEnv(env).query.webflowConnections.findFirst({ where: eq(schema.webflowConnections.id, connection.id) });
  if (current && fresh(current.expiresAt)) return current;
  if (current?.refreshToken) connection = current;

  const redirectUri = `${env.APP_URL.replace(/\/$/, "")}/api/webflow/callback`;
  const st: ProviderState = {
    clientInfo: connection.mcpClientId
      ? { client_id: connection.mcpClientId, ...(connection.mcpClientSecret ? { client_secret: connection.mcpClientSecret } : {}), ...clientMetadata(redirectUri) }
      : undefined,
    tokens: { access_token: connection.accessToken, refresh_token: connection.refreshToken ?? undefined, token_type: "bearer" },
  };
  const provider = makeProvider({ redirectUri, state: st, stateValue: () => crypto.randomUUID() });
  const result = await auth(provider, { serverUrl: connection.mcpServerUrl ?? env.WEBFLOW_MCP_URL });
  if (result !== "AUTHORIZED" || !st.tokens) {
    throw new Error("The Webflow connection has expired and could not be refreshed; reconnect the workspace");
  }
  const patch = {
    accessToken: st.tokens.access_token,
    refreshToken: st.tokens.refresh_token ?? connection.refreshToken,
    expiresAt: expiresAtFrom(st.tokens),
    scopes: st.tokens.scope ?? connection.scopes,
  };
  await dbFromEnv(env).update(schema.webflowConnections).set(patch).where(eq(schema.webflowConnections.id, connection.id));
  return { ...connection, ...patch };
}

// Cookie helpers for the in-flight authorization.
export const PENDING_COOKIE = "wf_mcp_auth";

export function encodePending(p: PendingAuth): string {
  return btoa(JSON.stringify(p));
}

export function decodePending(value: string | undefined): PendingAuth | null {
  if (!value) return null;
  try {
    return JSON.parse(atob(value)) as PendingAuth;
  } catch {
    return null;
  }
}
