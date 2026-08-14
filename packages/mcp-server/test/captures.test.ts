import { describe, expect, it } from "vitest";
import type { PageExtraction } from "@groundtab/protocol";
import { AuditLog, CaptureStore, ResearchRunGuard, redactUrlParameters, splitBlocks } from "../src/captures.js";

describe("splitBlocks", () => {
  it("creates stable block labels and removes empty blocks", () => {
    expect(splitBlocks("# Heading\n\nFirst paragraph.\n\n\nSecond paragraph.")).toEqual([
      { id: "B0001", text: "# Heading" },
      { id: "B0002", text: "First paragraph." },
      { id: "B0003", text: "Second paragraph." }
    ]);
  });
});

describe("CaptureStore", () => {
  it("evicts the oldest capture when the retention limit is reached", () => {
    const store = new CaptureStore(2);
    const first = store.add(page("First"));
    const second = store.add(page("Second"));
    const third = store.add(page("Third"));
    expect(store.get(first.id)).toBeUndefined();
    expect(store.list().map((capture) => capture.id)).toEqual([third.id, second.id]);
  });

  it("expires captures after the configured retention duration", () => {
    let now = 1_000;
    const store = new CaptureStore({ maxCaptures: 5, retentionMs: 100, now: () => now });
    const capture = store.add(page("Expiring"), "session-a");
    now = 1_099;
    expect(store.get(capture.id)?.sessionId).toBe("session-a");
    now = 1_100;
    expect(store.get(capture.id)).toBeUndefined();
  });

  it("returns fetch content without retaining it in do-not-retain mode", () => {
    const store = new CaptureStore({ doNotRetain: true });
    const capture = store.add(page("Transient"), "session-private");
    expect(capture.blocks).toHaveLength(1);
    expect(store.get(capture.id)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it("deletes one capture idempotently and clears all remaining captures explicitly", () => {
    const store = new CaptureStore();
    const first = store.add(page("First"));
    store.add(page("Second"));
    expect(store.delete(first.id)).toBe(true);
    expect(store.delete(first.id)).toBe(false);
    expect(store.clear()).toBe(1);
    expect(store.clear()).toBe(0);
  });

  it("redacts sensitive URL parameters everywhere retained metadata contains a URL", () => {
    const store = new CaptureStore({ redactedUrlParameters: ["token", "signature"] });
    const capture = store.add(page("Secrets", {
      requestedUrl: "https://example.com/article?token=raw&keep=yes",
      finalUrl: "https://example.com/article?signature=raw",
      canonicalUrl: "https://example.com/article?token=canonical",
      links: [{ text: "next", url: "https://example.com/next?token=linked" }]
    }));
    expect(JSON.stringify(capture)).not.toContain("raw");
    expect(JSON.stringify(capture)).not.toContain("=canonical");
    expect(JSON.stringify(capture)).not.toContain("=linked");
    expect(capture.requestedUrl).toContain("keep=yes");
    expect(capture.requestedUrl).toContain("token=REDACTED");
  });
});

describe("redactUrlParameters", () => {
  it("matches parameter names case-insensitively without removing ordinary parameters", () => {
    expect(redactUrlParameters("https://example.com/?Token=secret&page=2", ["token"]))
      .toBe("https://example.com/?Token=REDACTED&page=2");
  });
});

describe("AuditLog", () => {
  it("groups body-free records by research session and can be cleared", () => {
    const audit = new AuditLog();
    audit.add({
      sessionId: "session-a",
      operation: "fetch_rendered_page",
      domain: "example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      outcome: "succeeded",
      errorCode: null,
      contentHash: "a".repeat(64),
      captureId: null
    });
    audit.add({
      sessionId: "session-b",
      operation: "search_web",
      domain: "duckduckgo.com",
      startedAt: "2026-01-01T00:00:02.000Z",
      completedAt: "2026-01-01T00:00:03.000Z",
      outcome: "denied",
      errorCode: "policy_denylist",
      contentHash: null,
      captureId: null
    });
    const report = audit.exportReport("2026-01-01T00:01:00.000Z");
    expect(report.summary).toEqual({
      records: 2,
      sessions: 2,
      outcomes: { succeeded: 1, failed: 0, denied: 1, cancelled: 0 }
    });
    expect(JSON.stringify(report)).not.toContain("markdown");
    expect(audit.clear()).toBe(2);
    expect(audit.clear()).toBe(0);
    expect(audit.exportReport().summary.records).toBe(0);
  });
});

describe("ResearchRunGuard", () => {
  it("enforces both per-session page and process-wide in-flight limits", () => {
    const guard = new ResearchRunGuard(2, 1);
    const first = guard.begin("session-a");
    expect(first.allowed).toBe(true);
    expect(guard.begin("session-b")).toMatchObject({ allowed: false, reason: "concurrency_limit" });
    if (first.allowed) first.release();
    const second = guard.begin("session-a");
    expect(second.allowed).toBe(true);
    if (second.allowed) second.release();
    expect(guard.begin("session-a")).toMatchObject({ allowed: false, reason: "page_limit" });
  });
});

function page(title: string, overrides: Partial<PageExtraction> = {}): PageExtraction {
  return { ...basePage(title), ...overrides };
}

function basePage(title: string): PageExtraction {
  return {
    kind: "page" as const,
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    canonicalUrl: "https://example.com/",
    title,
    siteName: null,
    byline: null,
    excerpt: null,
    language: "en",
    markdown: `${title} content`,
    textLength: title.length + 8,
    links: [],
    capturedAt: new Date().toISOString(),
    challenge: false,
    challengeKind: null
  };
}
