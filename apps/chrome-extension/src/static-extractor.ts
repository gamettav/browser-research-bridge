import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { classifyChallengeText } from "./fast-fetch.js";

type ExtractStaticPageMessage = {
  type: "extract_static_page";
  requestedUrl: string;
  finalUrl: string;
  html: string;
  maxChars: number;
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isStaticExtractionMessage(message)) return;
  try {
    sendResponse(extractStaticPage(message));
  } catch (error) {
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  }
});

export function extractStaticPage(message: ExtractStaticPageMessage) {
  const document = new DOMParser().parseFromString(message.html, "text/html");
  document.querySelectorAll("base, script, style, noscript, template, svg, canvas, form, input, textarea, select, button").forEach((element) => element.remove());
  document.querySelectorAll('[hidden], [aria-hidden="true"], [contenteditable]').forEach((element) => element.remove());
  absolutizeDocumentUrls(document, message.finalUrl);

  const fallbackText = normalizeText(document.body?.textContent ?? "");
  const canonicalUrl = resolveHttpUrl(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null, message.finalUrl);
  const links = extractLinks(document, message.finalUrl, 300);
  const metadata = {
    siteName: meta(document, "og:site_name"),
    excerpt: meta(document, "description"),
    language: document.documentElement.lang || null
  };

  const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 120 }).parse();
  const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  turndown.remove(["script", "style", "noscript", "form", "input", "textarea", "select", "button"]);
  let markdown = article?.content ? turndown.turndown(article.content) : fallbackText;
  markdown = normalizeMarkdown(markdown).slice(0, message.maxChars);
  const title = article?.title?.trim() || document.title.trim() || new URL(message.finalUrl).hostname;
  const challengeKind = classifyChallengeText(title, fallbackText);

  return {
    kind: "page",
    requestedUrl: message.requestedUrl,
    finalUrl: message.finalUrl,
    canonicalUrl,
    title,
    siteName: article?.siteName?.trim() || metadata.siteName,
    byline: article?.byline?.trim() || null,
    excerpt: article?.excerpt?.trim() || metadata.excerpt,
    language: metadata.language,
    markdown,
    textLength: markdown.length,
    links,
    capturedAt: new Date().toISOString(),
    challenge: challengeKind !== null,
    challengeKind
  };
}

function absolutizeDocumentUrls(document: Document, baseUrl: string): void {
  for (const element of document.querySelectorAll<HTMLElement>("[href], [src]")) {
    for (const attribute of ["href", "src"] as const) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const resolved = resolveHttpUrl(value, baseUrl);
      if (resolved) element.setAttribute(attribute, resolved);
      else element.removeAttribute(attribute);
    }
  }
}

function extractLinks(document: Document, baseUrl: string, limit: number) {
  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const text = normalizeText(anchor.textContent ?? "");
    const url = resolveHttpUrl(anchor.getAttribute("href"), baseUrl);
    if (!text || !url || seen.has(url)) continue;
    seen.add(url);
    links.push({ text: text.slice(0, 500), url });
    if (links.length >= limit) break;
  }
  return links;
}

function resolveHttpUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\u00a0/g, " ").replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim();
}

function meta(document: Document, name: string): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || null;
}

function isStaticExtractionMessage(value: unknown): value is ExtractStaticPageMessage {
  return typeof value === "object" && value !== null && "type" in value && value.type === "extract_static_page";
}
