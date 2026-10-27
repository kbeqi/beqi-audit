import { Parser } from "htmlparser2";
import type { CrawledHeading, CrawledImage, CrawledLink, CrawledPage, CrawledScript } from "./types";

// Streaming HTML extraction with htmlparser2 (works in Workers; no DOM needed).
// We only collect what the checks consume, so memory stays small per page.

const EMPTY: Omit<CrawledPage, "url" | "path" | "status" | "finalUrl" | "redirected" | "contentType" | "fetchMs" | "htmlBytes"> = {
  title: null,
  metaDescription: null,
  metaRobots: null,
  canonical: null,
  lang: null,
  og: {},
  headings: [],
  images: [],
  links: [],
  scripts: [],
  stylesheets: [],
  jsonLd: [],
  classes: [],
  wordCount: 0,
  hasFaqHeading: false,
};

export function emptyPageFields() {
  return structuredClone(EMPTY);
}

export function parseHtml(html: string, pageUrl: string) {
  const out = emptyPageFields();
  const classSet = new Set<string>();
  const headings: CrawledHeading[] = [];
  const images: CrawledImage[] = [];
  const links: CrawledLink[] = [];
  const scripts: CrawledScript[] = [];

  let inHead = false;
  let inTitle = false;
  let inScript: CrawledScript | null = null;
  let scriptBuf = "";
  let jsonLdBuf: string | null = null;
  let currentHeading: CrawledHeading | null = null;
  let currentLink: CrawledLink | null = null;
  let textWords = 0;
  let skipText = 0; // depth inside <script>/<style>/<noscript>

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const cls = attrs.class;
        if (cls) for (const c of cls.split(/\s+/)) if (c) classSet.add(c);

        switch (name) {
          case "head":
            inHead = true;
            break;
          case "html":
            if (attrs.lang) out.lang = attrs.lang;
            break;
          case "title":
            if (inHead) inTitle = true;
            break;
          case "meta": {
            const n = (attrs.name ?? "").toLowerCase();
            const p = (attrs.property ?? "").toLowerCase();
            if (n === "description") out.metaDescription = attrs.content ?? "";
            else if (n === "robots") out.metaRobots = attrs.content ?? "";
            else if (p.startsWith("og:")) out.og[p.slice(3)] = attrs.content ?? "";
            break;
          }
          case "link": {
            const rel = (attrs.rel ?? "").toLowerCase();
            if (rel === "canonical" && attrs.href) out.canonical = absolute(attrs.href, pageUrl);
            if (rel.split(/\s+/).includes("stylesheet") && attrs.href) out.stylesheets.push(absolute(attrs.href, pageUrl));
            break;
          }
          case "script": {
            skipText++;
            const type = attrs.type?.toLowerCase();
            if (type === "application/ld+json") {
              jsonLdBuf = "";
            } else {
              inScript = {
                src: attrs.src ? absolute(attrs.src, pageUrl) : null,
                inHead,
                async: "async" in attrs,
                defer: "defer" in attrs,
                type,
              };
              scriptBuf = "";
            }
            break;
          }
          case "style":
          case "noscript":
          case "template":
            skipText++;
            break;
          case "h1":
          case "h2":
          case "h3":
          case "h4":
          case "h5":
          case "h6":
            currentHeading = { level: Number(name[1]), text: "" };
            break;
          case "img":
            images.push({ src: absolute(attrs.src ?? attrs["data-src"] ?? "", pageUrl), alt: "alt" in attrs ? attrs.alt : null, loading: attrs.loading });
            break;
          case "a":
            if (attrs.href !== undefined) {
              currentLink = { href: absolute(attrs.href, pageUrl), text: "", rel: attrs.rel };
            }
            break;
        }
      },
      ontext(text) {
        if (inTitle) out.title = (out.title ?? "") + text;
        if (jsonLdBuf !== null) {
          jsonLdBuf += text;
          return;
        }
        if (inScript) {
          if (scriptBuf.length < 400) scriptBuf += text;
          return;
        }
        if (skipText > 0) return;
        if (currentHeading) currentHeading.text += text;
        if (currentLink) currentLink.text += text;
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        textWords += words;
      },
      onclosetag(name) {
        switch (name) {
          case "head":
            inHead = false;
            break;
          case "title":
            inTitle = false;
            break;
          case "script":
            skipText = Math.max(0, skipText - 1);
            if (jsonLdBuf !== null) {
              out.jsonLd.push(parseJsonLd(jsonLdBuf));
              jsonLdBuf = null;
            } else if (inScript) {
              if (!inScript.src) inScript.snippet = scriptBuf.trim().slice(0, 200);
              scripts.push(inScript);
              inScript = null;
            }
            break;
          case "style":
          case "noscript":
          case "template":
            skipText = Math.max(0, skipText - 1);
            break;
          case "h1":
          case "h2":
          case "h3":
          case "h4":
          case "h5":
          case "h6":
            if (currentHeading) {
              currentHeading.text = squash(currentHeading.text);
              if (/\bfaq|frequently asked/i.test(currentHeading.text)) out.hasFaqHeading = true;
              headings.push(currentHeading);
              currentHeading = null;
            }
            break;
          case "a":
            if (currentLink) {
              currentLink.text = squash(currentLink.text).slice(0, 120);
              links.push(currentLink);
              currentLink = null;
            }
            break;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  out.title = out.title ? squash(out.title) : null;
  out.headings = headings;
  out.images = images;
  out.links = links;
  out.scripts = scripts;
  out.classes = [...classSet];
  out.wordCount = textWords;
  return out;
}

function parseJsonLd(raw: string): CrawledPage["jsonLd"][number] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return { raw: trimmed.slice(0, 4000), parsed, types: collectTypes(parsed) };
  } catch (e) {
    return { raw: trimmed.slice(0, 4000), parsed: null, error: (e as Error).message, types: [] };
  }
}

function collectTypes(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectTypes(n, acc));
  else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") acc.push(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && acc.push(x));
    if (Array.isArray(obj["@graph"])) collectTypes(obj["@graph"], acc);
    for (const k of ["mainEntity", "itemListElement", "publisher", "author"]) if (obj[k]) collectTypes(obj[k], acc);
  }
  return acc;
}

export function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Class names defined in a stylesheet, ignoring Webflow's framework classes (w-*).
export function extractCssClasses(css: string): string[] {
  const set = new Set<string>();
  const re = /\.(-?[_a-zA-Z][\w-]*)/g;
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    const name = m[1];
    if (name.startsWith("w-") || name.startsWith("w--")) continue;
    // Skip numeric-looking matches inside values like `.5s` (handled by regex) and pseudo noise.
    set.add(name);
  }
  return [...set];
}
