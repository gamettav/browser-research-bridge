import {
  errorCodeForChallenge,
  isTerminalPhase,
  terminalPhaseForError,
  type ChallengeKind,
  type ProgressEvent,
  type ResearchErrorCode,
  type ResearchPhase
} from "@browser-research/protocol";

export const PROGRESS_DEBOUNCE_MS = 700;

// The subset of the MCP tool handler's `extra` argument we use to stream progress.
export type ProgressExtra = {
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: { method: string; params: Record<string, unknown> }) => Promise<void>;
};

export type ReporterOptions = { sourceIndex?: number | undefined; sourceTotal?: number | undefined };

export type Reporter = {
  onProgress: (event: ProgressEvent) => void;
  done: (domain: string | null) => void;
  fail: (errorCode: ResearchErrorCode, domain: string | null) => void;
};

// Bridges relayed job progress to MCP `notifications/progress`, but only when the
// harness passed a progressToken. Intermediate events are throttled so a
// sub-second job never spams the harness; terminal events (done/fail) always send.
export function makeReporter(extra: unknown, options: ReporterOptions, now: () => number = Date.now): Reporter {
  const channel = extra as ProgressExtra | undefined;
  const token = channel?._meta?.progressToken;
  const enabled = token !== undefined && typeof channel?.sendNotification === "function";
  let progress = 0;
  let hasSent = false;
  let lastSentAt = 0;

  function send(phase: ResearchPhase, domain: string | null, errorCode?: ResearchErrorCode): void {
    if (!enabled) return;
    progress += 1;
    void channel!
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token!, progress, message: formatPhase(phase, domain, errorCode, options) }
      })
      .catch(() => undefined);
  }

  return {
    onProgress(event: ProgressEvent): void {
      if (isTerminalPhase(event.phase)) return; // the server emits its own terminal event
      const at = now();
      if (hasSent && at - lastSentAt < PROGRESS_DEBOUNCE_MS) return; // drop noisy sub-second updates
      hasSent = true;
      lastSentAt = at;
      send(event.phase, event.domain, event.errorCode);
    },
    done(domain: string | null): void {
      send("completed", domain);
    },
    fail(errorCode: ResearchErrorCode, domain: string | null): void {
      send(terminalPhaseForError(errorCode), domain, errorCode);
    }
  };
}

export function formatPhase(
  phase: ResearchPhase,
  domain: string | null,
  errorCode: ResearchErrorCode | undefined,
  options: ReporterOptions
): string {
  const counter = options.sourceTotal ? `Reading ${options.sourceIndex ?? "?"} of ${options.sourceTotal} · ` : "";
  const where = domain ? ` ${domain}` : "";
  const suffix = errorCode ? ` (${errorCode})` : "";
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
  return `${counter}${verb[phase]}${where}${suffix}`.trim();
}

// Maps an extension job-result error code to a structured, skill-usable code.
export function mapErrorCode(raw: string): ResearchErrorCode {
  switch (raw) {
    case "blocked_url": return "blocked_url";
    case "blocked_redirect":
    case "blocked_navigation": return "blocked_redirect";
    case "navigation_changed": return "navigation_changed";
    case "tab_create_failed": return "tab_failed";
    case "job_expired": return "job_expired";
    case "extraction_failed": return "extraction_failed";
    case "navigation_check_timeout": return "timeout";
    case "broker_disconnected": return "not_connected";
    default: return "bridge_error";
  }
}

export function classifyThrown(message: string): ResearchErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes("not connected")) return "not_connected";
  if (lower.includes("disconnected")) return "not_connected";
  if (lower.includes("timed out")) return "timeout";
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
