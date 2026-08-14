export type FastFetchFallbackReason =
  | "authentication_required"
  | "forbidden"
  | "http_error"
  | "challenge_page"
  | "empty_html_shell"
  | "javascript_required"
  | "unsupported_content_type";

export type FastFetchClassification =
  | { kind: "static" }
  | { kind: "fallback"; reason: FastFetchFallbackReason };

export type ChallengeKind = "captcha" | "login" | "denied" | null;
export type DomSnapshot = { readyState: string; textLength: number; elementCount: number };

type ResponseSample = {
  status: number;
  contentType: string | null;
  body: string;
};

const COMPATIBILITY_REASONS = new Set<FastFetchFallbackReason>([
  "challenge_page",
  "empty_html_shell",
  "javascript_required"
]);

export function classifyFastFetchResponse(sample: ResponseSample): FastFetchClassification {
  if (sample.status === 401) return { kind: "fallback", reason: "authentication_required" };
  if (sample.status === 403) return { kind: "fallback", reason: "forbidden" };
  if (sample.status >= 400 || sample.status === 204 || sample.status === 205) {
    return { kind: "fallback", reason: "http_error" };
  }

  const mediaType = sample.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const htmlSniff = /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(sample.body);
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml" && !(mediaType === "" && htmlSniff)) {
    return { kind: "fallback", reason: "unsupported_content_type" };
  }

  const text = htmlTextSample(sample.body);
  if (classifyChallengeText(extractTitle(sample.body), text) !== null) {
    return { kind: "fallback", reason: "challenge_page" };
  }

  const scriptCount = (sample.body.match(/<script\b/gi) ?? []).length;
  const javascriptSignal = /(?:enable|turn on|requires?)\s+javascript|javascript\s+(?:is\s+)?required/i.test(text);
  const emptyAppRoot = /<(?:div|main)\b[^>]*(?:id|class)=["'][^"']*(?:app|root|__next|__nuxt)[^"']*["'][^>]*>\s*<\/(?:div|main)>/i.test(sample.body);
  if (javascriptSignal || (text.length < 240 && (scriptCount >= 3 || emptyAppRoot))) {
    return { kind: "fallback", reason: "javascript_required" };
  }
  if (text.length < 80) return { kind: "fallback", reason: "empty_html_shell" };
  return { kind: "static" };
}

export function classifyChallengeText(title: string, text: string): ChallengeKind {
  const sample = `${title}\n${text.slice(0, 5_000)}`.toLowerCase();
  const has = (signals: string[]): boolean => signals.some((signal) => sample.includes(signal));
  if (has(["verify you are human", "checking your browser", "captcha", "attention required", "unusual traffic", "enable javascript and cookies"])) {
    return "captcha";
  }
  if (has(["sign in to continue", "log in to continue", "please sign in", "please log in", "you must be logged in"])) {
    return "login";
  }
  if (has(["access denied", "403 forbidden", "you don't have permission", "you do not have permission"])) {
    return "denied";
  }
  return null;
}

export function canonicalFetchKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function domSnapshotsAreStable(previous: DomSnapshot, current: DomSnapshot): boolean {
  if (current.readyState !== "complete") return false;
  const textTolerance = Math.max(20, Math.round(previous.textLength * 0.02));
  const elementTolerance = Math.max(3, Math.round(previous.elementCount * 0.02));
  return Math.abs(current.textLength - previous.textLength) <= textTolerance
    && Math.abs(current.elementCount - previous.elementCount) <= elementTolerance;
}

type CompatibilityEntry = {
  failures: number;
  skipUntil: number;
  lastObservedAt: number;
};

export class DomainCompatibilityMemory {
  readonly #entries = new Map<string, CompatibilityEntry>();

  constructor(
    private readonly failureThreshold = 2,
    private readonly incompatibleTtlMs = 15 * 60_000,
    private readonly maxEntries = 200
  ) {}

  shouldTryFast(url: string, now = Date.now()): boolean {
    const domain = domainFor(url);
    if (!domain) return true;
    const entry = this.#entries.get(domain);
    if (!entry) return true;
    if (entry.skipUntil > now) return false;
    if (entry.skipUntil !== 0) this.#entries.delete(domain);
    return true;
  }

  recordSuccess(url: string): void {
    const domain = domainFor(url);
    if (domain) this.#entries.delete(domain);
  }

  recordFallback(url: string, reason: FastFetchFallbackReason, now = Date.now()): void {
    if (!COMPATIBILITY_REASONS.has(reason)) return;
    const domain = domainFor(url);
    if (!domain) return;
    const previous = this.#entries.get(domain);
    const failures = (previous?.failures ?? 0) + 1;
    this.#entries.set(domain, {
      failures,
      skipUntil: failures >= this.failureThreshold ? now + this.incompatibleTtlMs : 0,
      lastObservedAt: now
    });
    this.#trim();
  }

  #trim(): void {
    if (this.#entries.size <= this.maxEntries) return;
    const oldest = [...this.#entries.entries()].sort((left, right) => left[1].lastObservedAt - right[1].lastObservedAt);
    for (const [domain] of oldest.slice(0, this.#entries.size - this.maxEntries)) this.#entries.delete(domain);
  }
}

function htmlTextSample(html: string): string {
  return decodeBasicEntities(html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(?:script|style|template|svg)\b[^>]*>[^]*?<\/(?:script|style|template|svg)>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function extractTitle(html: string): string {
  return decodeBasicEntities(/<title\b[^>]*>([^]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function domainFor(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}
