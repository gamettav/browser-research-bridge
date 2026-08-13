import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProgressEvent, ResearchPhase } from "@browser-research/protocol";
import { classifyThrown, formatPhase, makeReporter, mapErrorCode, searchDomain } from "../src/progress.js";

type Sent = { method: string; params: Record<string, unknown> };

function fakeExtra(progressToken: string | number | undefined) {
  const sent: Sent[] = [];
  const extra = progressToken === undefined
    ? { sendNotification: async (n: Sent) => { sent.push(n); } }
    : { _meta: { progressToken }, sendNotification: async (n: Sent) => { sent.push(n); } };
  return { extra, sent };
}

function ev(phase: ResearchPhase, domain: string | null): ProgressEvent {
  return { type: "job_progress", id: randomUUID(), phase, domain, elapsedMs: 0 };
}

describe("makeReporter", () => {
  it("throttles sub-second intermediate events but always sends terminal ones", () => {
    let now = 0;
    const { extra, sent } = fakeExtra("tok-1");
    const reporter = makeReporter(extra, { sourceIndex: 2, sourceTotal: 5 }, () => now);

    reporter.onProgress(ev("queued", "example.com"));       // t=0 → sent
    now = 100; reporter.onProgress(ev("navigating", "example.com")); // dropped (noise)
    now = 300; reporter.onProgress(ev("rendering", "example.com"));  // dropped (noise)
    now = 900; reporter.onProgress(ev("extracting", "example.com")); // t=900 → sent
    reporter.done("example.com");                            // terminal → always sent

    expect(sent.map((s) => s.params.message)).toEqual([
      "Reading 2 of 5 · Queued example.com",
      "Reading 2 of 5 · Extracting example.com",
      "Reading 2 of 5 · Done example.com"
    ]);
    // progress must be strictly increasing across the events actually sent
    expect(sent.map((s) => s.params.progress)).toEqual([1, 2, 3]);
    expect(sent.every((s) => s.params.progressToken === "tok-1")).toBe(true);
  });

  it("emits nothing when the harness sent no progressToken", () => {
    const { extra, sent } = fakeExtra(undefined);
    const reporter = makeReporter(extra, {});
    reporter.onProgress(ev("queued", "example.com"));
    reporter.done("example.com");
    reporter.fail("timeout", "example.com");
    expect(sent).toHaveLength(0);
  });

  it("maps a blocked error to a skipped terminal phase with the code", () => {
    const { extra, sent } = fakeExtra("tok-2");
    const reporter = makeReporter(extra, {});
    reporter.fail("blocked_captcha", "news.example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params.message).toBe("Skipped news.example.com (blocked_captcha)");
  });

  it("maps a hard error to a failed terminal phase", () => {
    const { extra, sent } = fakeExtra("tok-3");
    const reporter = makeReporter(extra, {});
    reporter.fail("timeout", "slow.example.com");
    expect(sent[0]!.params.message).toBe("Failed slow.example.com (timeout)");
  });
});

describe("formatPhase", () => {
  it("omits the counter when no source total is given", () => {
    expect(formatPhase("rendering", "example.com", undefined, {})).toBe("Rendering example.com");
  });
  it("handles a null domain", () => {
    expect(formatPhase("queued", null, undefined, {})).toBe("Queued");
  });
});

describe("mapErrorCode / classifyThrown / searchDomain", () => {
  it("maps extension codes to structured research codes", () => {
    expect(mapErrorCode("blocked_url")).toBe("blocked_url");
    expect(mapErrorCode("blocked_navigation")).toBe("blocked_redirect");
    expect(mapErrorCode("tab_create_failed")).toBe("tab_failed");
    expect(mapErrorCode("navigation_check_timeout")).toBe("timeout");
    expect(mapErrorCode("something_unknown")).toBe("bridge_error");
  });
  it("classifies thrown messages", () => {
    expect(classifyThrown("Chrome extension is not connected")).toBe("not_connected");
    expect(classifyThrown("Browser job timed out after 50000ms")).toBe("timeout");
    expect(classifyThrown("weird failure")).toBe("bridge_error");
  });
  it("returns provider domains", () => {
    expect(searchDomain("google")).toBe("www.google.com");
    expect(searchDomain("duckduckgo")).toBe("duckduckgo.com");
  });
});
