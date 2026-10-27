import type { CategoryKey, Severity } from "@/db/schema";
import type { WebflowCustomCodeBlock, WebflowPage, WebflowRegisteredScript, WebflowSite } from "@/lib/webflow/client";

// A finding as produced by a check, before it gets an id/run/fingerprint.
export interface FindingDraft {
  category: CategoryKey;
  checkId: string;
  severity: Severity;
  title: string;
  detail?: string;
  pagePath?: string;
  webflowPageId?: string;
  // Extra identity for the fingerprint when several findings share check + page
  // (e.g. one per broken URL). Omit when check + page is already unique.
  subject?: string;
  data?: Record<string, unknown>;
}

export interface WebflowSnapshot {
  site: WebflowSite;
  pages: WebflowPage[];
  registeredScripts: WebflowRegisteredScript[];
  siteCustomCode: WebflowCustomCodeBlock | null;
  pageCustomCode: WebflowCustomCodeBlock[];
  fetchedAt: string;
}

export interface CrawledLink {
  href: string; // absolute URL
  text: string;
  rel?: string;
}

export interface CrawledHeading {
  level: number;
  text: string;
}

export interface CrawledImage {
  src: string;
  alt: string | null;
  loading?: string;
}

export interface CrawledScript {
  src: string | null;
  inHead: boolean;
  async: boolean;
  defer: boolean;
  type?: string;
  // First 200 chars for inline scripts; used for duplicate-tag detection.
  snippet?: string;
}

export interface CrawledPage {
  url: string;
  path: string;
  status: number;
  finalUrl: string;
  redirected: boolean;
  contentType: string | null;
  fetchMs: number;
  htmlBytes: number;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  og: Record<string, string>;
  headings: CrawledHeading[];
  images: CrawledImage[];
  links: CrawledLink[];
  scripts: CrawledScript[];
  stylesheets: string[];
  jsonLd: { raw: string; parsed: unknown | null; error?: string; types: string[] }[];
  classes: string[]; // distinct class names used on the page
  wordCount: number;
  hasFaqHeading: boolean;
  error?: string;
}

export interface CrawlResult {
  baseUrl: string;
  host: string;
  startedAt: string;
  finishedAt: string;
  pages: CrawledPage[];
  robotsTxt: { status: number; body: string | null };
  llmsTxt: { status: number };
  sitemap: { status: number; urls: string[] };
  stylesheetClasses: Record<string, string[]>; // stylesheet URL -> class names defined
  truncated: boolean;
}

export interface LinkCheckResult {
  url: string;
  status: number | null; // null = network error / timeout
  finalUrl: string | null;
  hops: number;
  error?: string;
  internal: boolean;
  referrers: string[]; // page paths that link to it
}

export interface PsiResult {
  pagePath: string;
  strategy: "mobile" | "desktop";
  performanceScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  inpMs: number | null;
  totalBytes: number | null;
  fieldLcpMs: number | null;
  fieldCls: number | null;
  fieldInpMs: number | null;
  opportunities: { id: string; title: string; savingsMs: number }[];
  error?: string;
}

export interface AnalysisInput {
  siteBaseUrl: string;
  hasCustomDomain: boolean;
  webflow: WebflowSnapshot;
  crawl: CrawlResult;
  links: LinkCheckResult[];
  psi: PsiResult[];
  previousPsi: PsiResult[];
}
