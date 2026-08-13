import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createResearchContext, researchActivity, researchErrorPayload } from "../src/research.js";

describe("research result metadata", () => {
  it("generates a reusable UUID session and validates source counters", () => {
    const generated = createResearchContext(undefined, undefined, undefined);
    expect(generated.value.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const sessionId = randomUUID();
    expect(createResearchContext(sessionId, 2, 5)).toEqual({
      value: { sessionId, source: { index: 2, total: 5 } }
    });
    expect(createResearchContext(sessionId, 2, undefined).error).toContain("provided together");
    expect(createResearchContext(sessionId, 6, 5).error).toContain("cannot exceed");
  });

  it("returns domain-only activity and rounded per-source duration", () => {
    const context = { sessionId: randomUUID(), source: { index: 2, total: 5 } };
    expect(researchActivity(context, "docs.example.com", "completed", 1_234.6, true)).toEqual({
      sessionId: context.sessionId,
      source: { index: 2, total: 5 },
      activity: { domain: "docs.example.com" },
      outcome: "completed",
      durationMs: 1_235,
      nativeProgress: true
    });
    expect(researchActivity(context, "docs.example.com/private?q=secret", "completed", 1_000, true).activity.domain).toBeNull();
  });

  it("exposes skill-usable structured skip and failure codes", () => {
    const context = { sessionId: randomUUID() };
    expect(researchErrorPayload(context, "blocked_captcha", "challenge", "news.example.com", 2_000, false))
      .toMatchObject({
        error: { code: "blocked_captcha", outcome: "skipped", retryable: false },
        research: { outcome: "skipped", durationMs: 2_000, nativeProgress: false }
      });
    expect(researchErrorPayload(context, "timeout", "slow", "slow.example.com", 5_000, true))
      .toMatchObject({
        error: { code: "timeout", outcome: "failed", retryable: true },
        research: { outcome: "failed", durationMs: 5_000, nativeProgress: true }
      });
  });
});
