import {
  ResearchErrorCodeSchema,
  errorCodeForChallenge,
  isTerminalPhase,
  terminalPhaseForError,
  type ChallengeKind,
  type ProgressEvent,
  type ResearchContext,
  type ResearchErrorCode,
  type ResearchPhase,
  type SourceCounter
} from "@browser-research/protocol";

// Do not reveal progress for work that finishes in under a second. The tool
// result is enough feedback for fast calls; live updates are reserved for work
// long enough that a person would otherwise wonder whether it is still running.
export const MIN_VISIBLE_PROGRESS_MS = 1_000;
export const PROGRESS_THROTTLE_MS = 700;

// The subset of the MCP tool handler's `extra` argument used for native progress.
export type ProgressExtra = {
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: { method: string; params: Record<string, unknown> }) => Promise<void>;
};

export type Reporter = {
  readonly nativeProgress: boolean;
  onProgress: (event: ProgressEvent) => void;
  done: (domain: string | null, durationMs: number) => void;
  fail: (errorCode: ResearchErrorCode, domain: string | null, durationMs: number) => void;
};

// Bridges relayed job events to MCP `notifications/progress` when the harness
// supplies a progress token. The first update is delayed for one second, so a
// sub-second operation emits no progress notifications at all. Terminal events
// remain visible once a long-running operation has crossed that threshold.
export function makeReporter(extra: unknown, context: ResearchContext): Reporter {
  const channel = extra as ProgressExtra | undefined;
  const token = channel?._meta?.progressToken;
  const enabled = token !== undefined && typeof channel?.sendNotification === "function";
  let progress = 0;
  let lastSentElapsedMs = 0;
  let hasSent = false;
  let terminal = false;
  let latest: ProgressEvent | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;

  function send(
    phase: ResearchPhase,
    domain: string | null,
    elapsedMs: number,
    errorCode?: ResearchErrorCode,
    source?: SourceCounter
  ): void {
    if (!enabled) return;
    progress += 1;
    hasSent = true;
    lastSentElapsedMs = elapsedMs;
    void channel!
      .sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: token!,
          progress,
          message: formatPhase(phase, domain, errorCode, source ?? context.source, elapsedMs)
        }
      })
      .catch(() => undefined);
  }

  function reveal(): void {
    revealTimer = undefined;
    if (terminal || !latest) return;
    send(latest.phase, latest.domain, Math.max(latest.elapsedMs, MIN_VISIBLE_PROGRESS_MS), latest.errorCode, latest.source);
  }

  function finish(phase: "completed" | "skipped" | "failed", domain: string | null, durationMs: number, errorCode?: ResearchErrorCode): void {
    if (terminal) return;
    terminal = true;
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = undefined;
    if (!enabled || (!hasSent && durationMs < MIN_VISIBLE_PROGRESS_MS)) return;
    send(phase, domain, durationMs, errorCode, latest?.source);
  }

  return {
    nativeProgress: enabled,
    onProgress(event: ProgressEvent): void {
      if (terminal || event.sessionId !== context.sessionId) return;
      latest = event;
      if (isTerminalPhase(event.phase)) {
        finish(event.phase, event.domain, event.elapsedMs, event.errorCode);
        return;
      }
      if (!enabled) return;
      if (!hasSent) {
        if (!revealTimer) {
          revealTimer = setTimeout(reveal, Math.max(0, MIN_VISIBLE_PROGRESS_MS - event.elapsedMs));
          revealTimer.unref?.();
        }
        return;
      }
      if (event.elapsedMs - lastSentElapsedMs >= PROGRESS_THROTTLE_MS) {
        send(event.phase, event.domain, event.elapsedMs, event.errorCode, event.source);
      }
    },
    done(domain: string | null, durationMs: number): void {
      finish("completed", domain, durationMs);
    },
    fail(errorCode: ResearchErrorCode, domain: string | null, durationMs: number): void {
      finish(terminalPhaseForError(errorCode), domain, durationMs, errorCode);
    }
  };
}

export function formatPhase(
  phase: ResearchPhase,
  domain: string | null,
  errorCode: ResearchErrorCode | undefined,
  source: SourceCounter | undefined,
  elapsedMs: number
): string {
  const counter = source ? `Reading ${source.index} of ${source.total} · ` : "";
  const where = domain ? ` ${domain}` : "";
  const suffix = errorCode ? ` (${errorCode})` : "";
  const duration = isTerminalPhase(phase) ? ` · ${formatDuration(elapsedMs)}` : "";
  const verb: Record<ResearchPhase, string> = {
    queued: "Queued",
    searching: "Searching",
    navigating: "Opening",
    rendering: "Rendering",
    extracting: "Extracting",
    completed: "Done",
    skipped: "Skipped",
    failed: "Failed"
  };
  return `${counter}${verb[phase]}${where}${suffix}${duration}`.trim();
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

// Maps an extension or broker error code to the public research error contract.
export function mapErrorCode(raw: string): ResearchErrorCode {
  const known = ResearchErrorCodeSchema.safeParse(raw);
  if (known.success) return known.data;
  switch (raw) {
    case "blocked_navigation": return "blocked_redirect";
    case "blocked_dns": return "blocked_url";
    case "broker_disconnected": return "not_connected";
    case "navigation_check_timeout": return "timeout";
    case "tab_create_failed": return "tab_failed";
    default: return "bridge_error";
  }
}

export function classifyThrown(error: unknown): ResearchErrorCode {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return mapErrorCode(error.code);
  }
  const lower = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (lower.includes("not connected") || lower.includes("disconnected")) return "not_connected";
  if (lower.includes("timed out") || lower.includes("timeout")) return "timeout";
  if (lower.includes("schema-invalid") || lower.includes("protocol")) return "protocol_error";
  return "bridge_error";
}

export function challengeErrorCode(kind: ChallengeKind): ResearchErrorCode {
  return kind ? errorCodeForChallenge(kind) : "access_denied";
}

export function searchDomain(provider: "duckduckgo" | "bing" | "google"): string {
  if (provider === "google") return "www.google.com";
  if (provider === "bing") return "www.bing.com";
  return "duckduckgo.com";
}
