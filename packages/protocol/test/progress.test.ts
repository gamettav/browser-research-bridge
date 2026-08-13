import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ProgressEventSchema,
  errorCodeForChallenge,
  isSkippableErrorCode,
  isTerminalPhase,
  safeDomain,
  terminalPhaseForError
} from "../src/index.js";

describe("ProgressEventSchema", () => {
  it("accepts a valid event and defaults domain to null", () => {
    const parsed = ProgressEventSchema.parse({ type: "job_progress", id: randomUUID(), phase: "rendering" });
    expect(parsed.domain).toBeNull();
    expect(parsed.phase).toBe("rendering");
  });
  it("rejects an unknown phase and a non-uuid id", () => {
    expect(ProgressEventSchema.safeParse({ type: "job_progress", id: randomUUID(), phase: "thinking" }).success).toBe(false);
    expect(ProgressEventSchema.safeParse({ type: "job_progress", id: "not-a-uuid", phase: "queued" }).success).toBe(false);
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
