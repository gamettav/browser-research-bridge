import { randomUUID } from "node:crypto";
import {
  ActivityDomainSchema,
  terminalPhaseForError,
  type ResearchContext,
  type ResearchErrorCode
} from "@browser-research/protocol";

export function createResearchContext(
  sessionId: string | undefined,
  sourceIndex: number | undefined,
  sourceTotal: number | undefined
): { value: ResearchContext; error?: string } {
  const value: ResearchContext = { sessionId: sessionId ?? randomUUID() };
  if (sourceIndex === undefined && sourceTotal === undefined) return { value };
  if (sourceIndex === undefined || sourceTotal === undefined) {
    return { value, error: "sourceIndex and sourceTotal must be provided together" };
  }
  if (sourceIndex > sourceTotal) {
    return { value, error: "sourceIndex cannot exceed sourceTotal" };
  }
  value.source = { index: sourceIndex, total: sourceTotal };
  return { value };
}

export function researchActivity(
  context: ResearchContext,
  domain: string | null,
  outcome: "completed" | "skipped" | "failed",
  durationMs: number,
  nativeProgress: boolean
) {
  const parsedDomain = domain === null ? null : ActivityDomainSchema.safeParse(domain);
  return {
    sessionId: context.sessionId,
    source: context.source ?? null,
    activity: { domain: parsedDomain === null ? null : parsedDomain.success ? parsedDomain.data : null },
    outcome,
    durationMs: Math.max(0, Math.round(durationMs)),
    nativeProgress
  };
}

export function researchErrorPayload(
  context: ResearchContext,
  code: ResearchErrorCode,
  message: string,
  domain: string | null,
  durationMs: number,
  nativeProgress: boolean
) {
  const outcome = terminalPhaseForError(code);
  return {
    sessionId: context.sessionId,
    research: researchActivity(context, domain, outcome, durationMs, nativeProgress),
    error: {
      code,
      message,
      outcome,
      retryable: code === "timeout"
    }
  };
}
