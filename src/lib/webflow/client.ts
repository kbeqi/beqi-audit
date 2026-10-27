// Thin client for the Webflow Data API v2. Only the endpoints the audits need.
// Rate limits are per site plan (60 or 120 req/min); callers should space out
// bulk calls, and every function here retries once on 429 using Retry-After.

const API = "https://api.webflow.com/v2";

export class WebflowApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`Webflow API ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

async function request<T>(token: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429 && attempt < 1) {
    const wait = Number(res.headers.get("retry-after") ?? "2") * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
    return request<T>(token, path, init, attempt + 1);
  }
  if (!res.ok) throw new WebflowApiError(res.status, await res.text(), path);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface WebflowTokenInfo {
  authorization: {
    id: string;
    createdOn: string;
    grantType: string;
    authorizedTo: { siteIds: string[]; workspaceIds: string[]; userIds: string[] };
  };
  application: { id: string; description: string; homepage: string; displayName: string };
}

export interface WebflowSite {
  id: string;
  workspaceId: string;
  displayName: string;
  shortName: string;
  previewUrl?: string;
  timeZone?: string;
  createdOn?: string;
  lastPublished?: string;
  lastUpdated?: string;
  customDomains?: { id: string; url: string; lastPublished?: string }[];
  locales?: { primary?: { id: string; tag: string }; secondary?: { id: string; tag: string }[] };
}

export interface WebflowPage {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  parentId?: string | null;
  collectionId?: string | null;
  createdOn?: string;
  lastUpdated?: string;
  archived?: boolean;
  draft?: boolean;
  canBranch?: boolean;
  isBranch?: boolean;
  isMembersOnly?: boolean;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  openGraph?: {
    title?: string | null;
    titleCopied?: boolean;
    description?: string | null;
    descriptionCopied?: boolean;
  };
  localeId?: string;
}

export interface WebflowRegisteredScript {
  id: string;
  displayName: string;
  version: string;
  canCopy?: boolean;
  hostedLocation?: string;
  integrityHash?: string;
  createdOn?: string;
  lastUpdated?: string;
}

export interface WebflowAppliedScript {
  id: string;
  location: "header" | "footer";
  version: string;
  attributes?: Record<string, string>;
}

export interface WebflowCustomCodeBlock {
  siteId?: string;
  pageId?: string;
  type?: "site" | "page";
  scripts: WebflowAppliedScript[];
  createdOn?: string;
  lastUpdated?: string;
}

export const webflow = {
  tokenInfo: (token: string) => request<WebflowTokenInfo>(token, "/token/introspect"),

  listSites: async (token: string) => (await request<{ sites: WebflowSite[] }>(token, "/sites")).sites,

  getSite: (token: string, siteId: string) => request<WebflowSite>(token, `/sites/${siteId}`),

  // Paginates through every static page (collection template pages included).
  listPages: async (token: string, siteId: string): Promise<WebflowPage[]> => {
    const out: WebflowPage[] = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
      const page = await request<{ pages: WebflowPage[]; pagination: { total: number } }>(
        token,
        `/sites/${siteId}/pages?limit=${limit}&offset=${offset}`,
      );
      out.push(...page.pages);
      offset += limit;
      if (out.length >= page.pagination.total || page.pages.length === 0) break;
    }
    return out;
  },

  updatePageSettings: (
    token: string,
    pageId: string,
    body: { title?: string; slug?: string; seo?: { title?: string; description?: string }; openGraph?: Record<string, unknown> },
  ) => request<WebflowPage>(token, `/pages/${pageId}`, { method: "PUT", body: JSON.stringify(body) }),

  listRegisteredScripts: async (token: string, siteId: string) =>
    (await request<{ registeredScripts: WebflowRegisteredScript[] }>(token, `/sites/${siteId}/registered_scripts`))
      .registeredScripts,

  getSiteCustomCode: (token: string, siteId: string) =>
    request<WebflowCustomCodeBlock>(token, `/sites/${siteId}/custom_code`),

  // Returns every page-level custom code block for a site (paginated).
  listPageCustomCode: async (token: string, siteId: string): Promise<WebflowCustomCodeBlock[]> => {
    const out: WebflowCustomCodeBlock[] = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
      const res = await request<{ blocks: WebflowCustomCodeBlock[]; pagination: { total: number } }>(
        token,
        `/sites/${siteId}/custom_code/blocks?limit=${limit}&offset=${offset}`,
      );
      out.push(...res.blocks);
      offset += limit;
      if (out.length >= res.pagination.total || res.blocks.length === 0) break;
    }
    return out;
  },

  listWebhooks: async (token: string, siteId: string) =>
    (await request<{ webhooks: { id: string; triggerType: string; url: string }[] }>(token, `/sites/${siteId}/webhooks`))
      .webhooks,

  createWebhook: (token: string, siteId: string, triggerType: string, url: string) =>
    request<{ id: string }>(token, `/sites/${siteId}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ triggerType, url }),
    }),
};

// Picks the URL the crawler should use: first custom domain, else the webflow.io preview.
export function siteBaseUrl(site: WebflowSite): string {
  const custom = site.customDomains?.[0]?.url;
  if (custom) return custom.startsWith("http") ? custom : `https://${custom}`;
  return `https://${site.shortName}.webflow.io`;
}
