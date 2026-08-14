import { describe, expect, it } from "vitest";
import {
  canonicalFetchKey,
  classifyChallengeText,
  classifyFastFetchResponse,
  DomainCompatibilityMemory,
  domSnapshotsAreStable
} from "../src/fast-fetch.js";

const articleHtml = `<!doctype html><html><head><title>Useful article</title></head><body><main>
  <h1>Useful article</h1><p>${"Independent evidence and technical detail. ".repeat(10)}</p>
</main></body></html>`;

describe("classifyFastFetchResponse", () => {
  it("accepts meaningful static HTML", () => {
    expect(classifyFastFetchResponse({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml }))
      .toEqual({ kind: "static" });
  });

  it("sniffs HTML when content-type is absent", () => {
    expect(classifyFastFetchResponse({ status: 200, contentType: null, body: articleHtml }))
      .toEqual({ kind: "static" });
  });

  it.each([
    [401, "authentication_required"],
    [403, "forbidden"]
  ] as const)("classifies HTTP %s before parsing", (status, reason) => {
    expect(classifyFastFetchResponse({ status, contentType: "text/html", body: articleHtml }))
      .toEqual({ kind: "fallback", reason });
  });

  it("detects challenge pages", () => {
    const body = "<html><title>Attention Required</title><body>Verify you are human to continue</body></html>";
    expect(classifyFastFetchResponse({ status: 200, contentType: "text/html", body }))
      .toEqual({ kind: "fallback", reason: "challenge_page" });
  });

  it("detects empty and JavaScript-dependent shells", () => {
    expect(classifyFastFetchResponse({
      status: 200,
      contentType: "text/html",
      body: "<html><body></body></html>"
    })).toEqual({ kind: "fallback", reason: "empty_html_shell" });

    expect(classifyFastFetchResponse({
      status: 200,
      contentType: "text/html",
      body: '<html><body><div id="root"></div><script src="1.js"></script><script src="2.js"></script><script src="3.js"></script></body></html>'
    })).toEqual({ kind: "fallback", reason: "javascript_required" });
  });

  it("rejects content types that the static extractor does not support", () => {
    expect(classifyFastFetchResponse({ status: 200, contentType: "application/pdf", body: "%PDF-1.7" }))
      .toEqual({ kind: "fallback", reason: "unsupported_content_type" });
  });
});

describe("challenge signals", () => {
  it("keeps the rendered and static paths on the same challenge vocabulary", () => {
    expect(classifyChallengeText("Sign in", "Please log in to continue")).toBe("login");
    expect(classifyChallengeText("Forbidden", "You don't have permission")).toBe("denied");
    expect(classifyChallengeText("Article", "Ordinary public content")).toBeNull();
  });
});

describe("DomainCompatibilityMemory", () => {
  it("temporarily skips a domain only after repeated compatibility failures", () => {
    const memory = new DomainCompatibilityMemory(2, 1_000);
    memory.recordFallback("https://docs.example.test/a", "javascript_required", 10_000);
    expect(memory.shouldTryFast("https://docs.example.test/b", 10_100)).toBe(true);
    memory.recordFallback("https://docs.example.test/b", "empty_html_shell", 10_200);
    expect(memory.shouldTryFast("https://docs.example.test/c", 10_300)).toBe(false);
    expect(memory.shouldTryFast("https://docs.example.test/c", 11_201)).toBe(true);
  });

  it("does not penalize a whole domain for page-specific HTTP or content-type results", () => {
    const memory = new DomainCompatibilityMemory(1, 1_000);
    memory.recordFallback("https://example.test/private", "authentication_required", 10_000);
    memory.recordFallback("https://example.test/file.pdf", "unsupported_content_type", 10_000);
    expect(memory.shouldTryFast("https://example.test/article", 10_100)).toBe(true);
  });

  it("clears learned incompatibility after a successful static extraction", () => {
    const memory = new DomainCompatibilityMemory(1, 1_000);
    memory.recordFallback("https://example.test/a", "javascript_required", 10_000);
    expect(memory.shouldTryFast("https://example.test/b", 10_100)).toBe(false);
    memory.recordSuccess("https://example.test/a");
    expect(memory.shouldTryFast("https://example.test/b", 10_200)).toBe(true);
  });
});

describe("fast-path request and rendered settle helpers", () => {
  it("deduplicates URL fragments without changing the request URL otherwise", () => {
    expect(canonicalFetchKey("https://example.test/article?q=1#section"))
      .toBe("https://example.test/article?q=1");
  });

  it("settles completed DOMs when text and element counts stop materially changing", () => {
    expect(domSnapshotsAreStable(
      { readyState: "complete", textLength: 1_000, elementCount: 100 },
      { readyState: "complete", textLength: 1_015, elementCount: 102 }
    )).toBe(true);
    expect(domSnapshotsAreStable(
      { readyState: "complete", textLength: 1_000, elementCount: 100 },
      { readyState: "complete", textLength: 1_400, elementCount: 140 }
    )).toBe(false);
  });
});
