import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { classifyChallengeText } from "./fast-fetch.js";

type ExtractPageMessage = { type: "extract_page"; requestedUrl: string; maxChars: number };
type ExtractSearchMessage = {
  type: "extract_search";
  query: string;
  provider: "duckduckgo" | "bing" | "google";
  limit: number;
  finalUrl: string;
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRecord(message)) return;
  if (message.type === "extract_page") {
    try { sendResponse(extractPage(message as unknown as ExtractPageMessage)); }
    catch (error) { sendResponse({ error: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  if (message.type === "extract_search") {
    try { sendResponse(extractSearch(message as unknown as ExtractSearchMessage)); }
    catch (error) { sendResponse({ error: error instanceof Error ? error.message : String(error) }); }
  }
});

function extractPage(message: ExtractPageMessage) {
  const clone = sanitizedClone();
  const article = new Readability(clone, { charThreshold: 120 }).parse();
  const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  turndown.remove(["script", "style", "noscript", "form", "input", "textarea", "select", "button"]);

  const fallbackText = visibleBodyText();
  let markdown = article?.content ? turndown.turndown(article.content) : fallbackText;
  markdown = normalizeMarkdown(markdown).slice(0, message.maxChars);
  const links = extractLinks(300);
  const canonicalUrl = absoluteUrl(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null);
  const title = article?.title?.trim() || document.title.trim() || location.hostname;
  const challengeKind = classifyChallengeText(title, fallbackText);

  return {
    kind: "page",
    requestedUrl: message.requestedUrl,
    finalUrl: location.href,
    canonicalUrl,
    title,
    siteName: article?.siteName?.trim() || meta("og:site_name"),
    byline: article?.byline?.trim() || null,
    excerpt: article?.excerpt?.trim() || meta("description"),
    language: document.documentElement.lang || null,
    markdown,
    textLength: markdown.length,
    links,
    capturedAt: new Date().toISOString(),
    challenge: challengeKind !== null,
    challengeKind
  };
}

function extractSearch(message: ExtractSearchMessage) {
  const candidates = searchCandidates(message.provider);
  const seen = new Set<string>();
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  for (const candidate of candidates) {
    const url = normalizeResultUrl(candidate.anchor.href, message.provider);
    const title = candidate.title.trim();
    if (!url || !title || seen.has(url) || isSearchEngineInternal(url, message.provider)) continue;
    seen.add(url);
    results.push({ title, url, snippet: candidate.snippet.trim().slice(0, 800) });
    if (results.length >= message.limit) break;
  }

  const challengeKind = classifyChallengeText(document.title, visibleBodyText());

  return {
    kind: "search",
    query: message.query,
    provider: message.provider,
    finalUrl: location.href,
    results,
    capturedAt: new Date().toISOString(),
    challenge: challengeKind !== null || results.length === 0,
    challengeKind
  };
}

function sanitizedClone(): Document {
  const clone = document.cloneNode(true) as Document;
  const originals = [...document.querySelectorAll<HTMLElement>("body *")];
  const copies = [...clone.querySelectorAll<HTMLElement>("body *")];
  const max = Math.min(originals.length, copies.length, 20_000);

  for (let index = 0; index < max; index += 1) {
    const original = originals[index];
    const copy = copies[index];
    if (!original || !copy) continue;
    const style = getComputedStyle(original);
    if (
      original.hidden ||
      original.getAttribute("aria-hidden") === "true" ||
      original.isContentEditable ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      copy.setAttribute("data-browser-research-remove", "true");
    }
  }

  clone.querySelectorAll([
    "script", "style", "noscript", "template", "svg", "canvas", "form", "input", "textarea", "select", "button",
    "[hidden]", '[aria-hidden="true"]', "[contenteditable]", '[data-browser-research-remove="true"]'
  ].join(",")).forEach((element) => element.remove());
  return clone;
}

function visibleBodyText(): string {
  return (document.body?.innerText ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

function extractLinks(limit: number) {
  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const text = anchor.innerText.trim().replace(/\s+/g, " ");
    const url = absoluteUrl(anchor.href);
    if (!text || !url || seen.has(url) || !/^https?:/.test(url)) continue;
    const style = getComputedStyle(anchor);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    seen.add(url);
    links.push({ text: text.slice(0, 500), url });
    if (links.length >= limit) break;
  }
  return links;
}

function searchCandidates(provider: ExtractSearchMessage["provider"]) {
  if (provider === "google") {
    return [...document.querySelectorAll<HTMLElement>("a:has(h3)")].map((anchor) => ({
      anchor: anchor as HTMLAnchorElement,
      title: anchor.querySelector("h3")?.textContent ?? "",
      snippet: anchor.closest("div[data-snhf]")?.textContent ?? anchor.parentElement?.parentElement?.textContent ?? ""
    }));
  }
  if (provider === "bing") {
    return [...document.querySelectorAll<HTMLElement>("li.b_algo")].map((item) => ({
      anchor: item.querySelector<HTMLAnchorElement>("h2 a")!,
      title: item.querySelector("h2")?.textContent ?? "",
      snippet: item.querySelector(".b_caption p")?.textContent ?? ""
    })).filter((item) => item.anchor);
  }
  const items = [...document.querySelectorAll<HTMLElement>("article[data-testid='result'], .result")];
  return items.map((item) => ({
    anchor: item.querySelector<HTMLAnchorElement>("a[data-testid='result-title-a'], h2 a, .result__a")!,
    title: item.querySelector("h2, [data-testid='result-title-a'], .result__a")?.textContent ?? "",
    snippet: item.querySelector("[data-result='snippet'], [data-testid='result-snippet'], .result__snippet")?.textContent ?? ""
  })).filter((item) => item.anchor);
}

function normalizeResultUrl(raw: string, provider: ExtractSearchMessage["provider"]): string | null {
  try {
    const url = new URL(raw, location.href);
    if (provider === "google" && url.hostname.endsWith("google.com") && url.pathname === "/url") {
      return absoluteUrl(url.searchParams.get("q"));
    }
    if (provider === "duckduckgo" && url.hostname.endsWith("duckduckgo.com") && url.searchParams.has("uddg")) {
      return absoluteUrl(url.searchParams.get("uddg"));
    }
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

function isSearchEngineInternal(url: string, provider: ExtractSearchMessage["provider"]): boolean {
  const host = new URL(url).hostname;
  if (provider === "google") return host === "google.com" || host.endsWith(".google.com");
  if (provider === "bing") return host === "bing.com" || host.endsWith(".bing.com");
  return host === "duckduckgo.com" || host.endsWith(".duckduckgo.com");
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\u00a0/g, " ").replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim();
}

function meta(name: string): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || null;
}

function absoluteUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
