import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ProgressEventSchema,
  JobMessageSchema,
  JobResultMessageSchema,
  errorCodeForChallenge,
  isSkippableErrorCode,
  isTerminalPhase,
  safeDomain,
  terminalPhaseForError
} from "../src/index.js";

describe("ProgressEventSchema", () => {
  it("accepts a valid event and defaults domain to null", () => {
    const parsed = ProgressEventSchema.parse({
      type: "job_progress",
      id: randomUUID(),
      sessionId: randomUUID(),
      source: { index: 2, total: 5 },
      phase: "rendering",
      elapsedMs: 1_250
    });
    expect(parsed.domain).toBeNull();
    expect(parsed.phase).toBe("rendering");
    expect(parsed.source).toEqual({ index: 2, total: 5 });
  });
  it("rejects an unknown phase and a non-uuid id", () => {
    const base = { type: "job_progress", id: randomUUID(), sessionId: randomUUID(), elapsedMs: 0 };
    expect(ProgressEventSchema.safeParse({ ...base, phase: "thinking" }).success).toBe(false);
    expect(ProgressEventSchema.safeParse({ ...base, id: "not-a-uuid", phase: "queued" }).success).toBe(false);
  });
  it("rejects unsafe activity metadata and invalid terminal error combinations", () => {
    const base = { type: "job_progress", id: randomUUID(), sessionId: randomUUID(), elapsedMs: 500 };
    expect(ProgressEventSchema.safeParse({ ...base, phase: "rendering", domain: "example.com/private?q=secret" }).success).toBe(false);
    expect(ProgressEventSchema.safeParse({ ...base, phase: "failed" }).success).toBe(false);
    expect(ProgressEventSchema.safeParse({ ...base, phase: "skipped", errorCode: "timeout" }).success).toBe(false);
    expect(ProgressEventSchema.safeParse({ ...base, phase: "failed", errorCode: "timeout" }).success).toBe(true);
  });
});

describe("research correlation", () => {
  it("requires a session and valid source counter on wire jobs", () => {
    const valid = {
      type: "job",
      id: randomUUID(),
      sessionId: randomUUID(),
      source: { index: 2, total: 5 },
      queuedAt: Date.now(),
      deadlineAt: Date.now() + 5_000,
      job: { kind: "search_web", query: "q", provider: "duckduckgo", limit: 5, timeoutMs: 5_000 }
    };
    expect(JobMessageSchema.safeParse(valid).success).toBe(true);
    expect(JobMessageSchema.safeParse({ ...valid, sessionId: undefined }).success).toBe(false);
    expect(JobMessageSchema.safeParse({ ...valid, source: { index: 6, total: 5 } }).success).toBe(false);
  });

  it("requires normalized errors and per-source duration on results", () => {
    const base = { type: "job_result", id: randomUUID(), sessionId: randomUUID(), durationMs: 1_500, ok: false };
    expect(JobResultMessageSchema.safeParse({ ...base, error: { code: "timeout", message: "slow" } }).success).toBe(true);
    expect(JobResultMessageSchema.safeParse({ ...base, error: { code: "made_up", message: "bad" } }).success).toBe(false);
    expect(JobResultMessageSchema.safeParse({ ...base, durationMs: undefined, error: { code: "timeout", message: "slow" } }).success).toBe(false);
  });
});

describe("safeDomain", () => {
  it("returns the bare hostname and never the path or query", () => {
    expect(safeDomain("https://Docs.Example.com/a/b?token=secret#x")).toBe("docs.example.com");
  });
  it("returns null for junk or missing input", () => {
    expect(safeDomain("not a url")).toBeNull();
    expect(safeDomain(null)).toBeNull();
    expect(safeDomain(undefined)).toBeNull();
  });
});

describe("error classification", () => {
  it("treats blocked/recoverable codes as skippable and everything else as failed", () => {
    expect(isSkippableErrorCode("blocked_captcha")).toBe(true);
    expect(isSkippableErrorCode("requires_login")).toBe(true);
    expect(isSkippableErrorCode("access_denied")).toBe(true);
    expect(isSkippableErrorCode("timeout")).toBe(false);
    expect(isSkippableErrorCode("bridge_error")).toBe(false);
    expect(terminalPhaseForError("access_denied")).toBe("skipped");
    expect(terminalPhaseForError("timeout")).toBe("failed");
  });
  it("maps challenge kinds to structured codes", () => {
    expect(errorCodeForChallenge("captcha")).toBe("blocked_captcha");
    expect(errorCodeForChallenge("login")).toBe("requires_login");
    expect(errorCodeForChallenge("denied")).toBe("access_denied");
    expect(errorCodeForChallenge(null)).toBe("access_denied");
  });
  it("identifies terminal phases", () => {
    expect(isTerminalPhase("completed")).toBe(true);
    expect(isTerminalPhase("skipped")).toBe(true);
    expect(isTerminalPhase("failed")).toBe(true);
    expect(isTerminalPhase("rendering")).toBe(false);
  });
});
