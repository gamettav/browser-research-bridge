import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgressEvent, ResearchContext, ResearchErrorCode, ResearchPhase } from "@browser-research/protocol";
import { classifyThrown, formatDuration, formatPhase, makeReporter, mapErrorCode, searchDomain } from "../src/progress.js";

type Sent = { method: string; params: Record<string, unknown> };

const context: ResearchContext = { sessionId: randomUUID(), source: { index: 2, total: 5 } };

function fakeExtra(progressToken: string | number | undefined) {
  const sent: Sent[] = [];
  const extra = progressToken === undefined
    ? { sendNotification: async (notification: Sent) => { sent.push(notification); } }
    : { _meta: { progressToken }, sendNotification: async (notification: Sent) => { sent.push(notification); } };
  return { extra, sent };
}

function event(
  phase: ResearchPhase,
  elapsedMs: number,
  domain: string | null = "example.com",
  errorCode?: ResearchErrorCode
): ProgressEvent {
  return { type: "job_progress", id: randomUUID(), sessionId: context.sessionId, source: context.source, phase, domain, elapsedMs, errorCode };
}

afterEach(() => vi.useRealTimers());

describe("makeReporter", () => {
  it("suppresses every native update for a sub-second operation", () => {
    vi.useFakeTimers();
    const { extra, sent } = fakeExtra("tok-fast");
    const reporter = makeReporter(extra, context);

    reporter.onProgress(event("queued", 0));
    vi.advanceTimersByTime(200);
    reporter.onProgress(event("rendering", 200));
    reporter.onProgress(event("completed", 450));
    vi.runAllTimers();

    expect(sent).toHaveLength(0);
  });

  it("delays and throttles long-running activity, then includes the source duration", () => {
    vi.useFakeTimers();
    const { extra, sent } = fakeExtra("tok-1");
    const reporter = makeReporter(extra, context);

    reporter.onProgress(event("queued", 0));
    vi.advanceTimersByTime(400);
    reporter.onProgress(event("navigating", 400));
    vi.advanceTimersByTime(600); // the delayed reveal emits the latest phase
    reporter.onProgress(event("rendering", 1_200)); // throttled
    reporter.onProgress(event("extracting", 1_800));
    reporter.onProgress(event("completed", 2_250));

    expect(sent.map((item) => item.params.message)).toEqual([
      "Reading 2 of 5 · Opening example.com",
      "Reading 2 of 5 · Extracting example.com",
      "Reading 2 of 5 · Done example.com · 2.3s"
    ]);
    expect(sent.map((item) => item.params.progress)).toEqual([1, 2, 3]);
    expect(sent.every((item) => item.params.progressToken === "tok-1")).toBe(true);
  });

  it("emits nothing when the harness sent no progressToken", () => {
    const { extra, sent } = fakeExtra(undefined);
    const reporter = makeReporter(extra, context);
    reporter.onProgress(event("queued", 0));
    reporter.done("example.com", 2_000);
    reporter.fail("timeout", "example.com", 2_000);
    expect(reporter.nativeProgress).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("maps blocked and hard errors to distinct terminal outcomes", () => {
    const skipped = fakeExtra("tok-2");
    makeReporter(skipped.extra, context).fail("blocked_captcha", "news.example.com", 1_500);
    expect(skipped.sent[0]!.params.message).toBe("Reading 2 of 5 · Skipped news.example.com (blocked_captcha) · 1.5s");

    const failed = fakeExtra("tok-3");
    makeReporter(failed.extra, context).fail("timeout", "slow.example.com", 12_000);
    expect(failed.sent[0]!.params.message).toBe("Reading 2 of 5 · Failed slow.example.com (timeout) · 12s");
  });
});

describe("formatPhase / formatDuration", () => {
  it("omits the counter when none is given and handles a null domain", () => {
    expect(formatPhase("rendering", "example.com", undefined, undefined, 1_000)).toBe("Rendering example.com");
    expect(formatPhase("queued", null, undefined, undefined, 0)).toBe("Queued");
  });

  it("uses compact millisecond and second durations", () => {
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1_250)).toBe("1.3s");
    expect(formatDuration(12_000)).toBe("12s");
  });
});

describe("mapErrorCode / classifyThrown / searchDomain", () => {
  it("maps wire and legacy error codes to the public contract", () => {
    expect(mapErrorCode("blocked_url")).toBe("blocked_url");
    expect(mapErrorCode("blocked_navigation")).toBe("blocked_redirect");
    expect(mapErrorCode("tab_create_failed")).toBe("tab_failed");
    expect(mapErrorCode("navigation_check_timeout")).toBe("timeout");
    expect(mapErrorCode("something_unknown")).toBe("bridge_error");
  });

  it("prefers structured thrown codes and falls back to safe message classification", () => {
    expect(classifyThrown(Object.assign(new Error("anything"), { code: "extraction_failed" }))).toBe("extraction_failed");
    expect(classifyThrown(new Error("Chrome extension is not connected"))).toBe("not_connected");
    expect(classifyThrown(new Error("Browser job timed out after 50000ms"))).toBe("timeout");
    expect(classifyThrown(new Error("weird failure"))).toBe("bridge_error");
  });

  it("returns provider domains", () => {
    expect(searchDomain("google")).toBe("www.google.com");
    expect(searchDomain("duckduckgo")).toBe("duckduckgo.com");
  });
});
