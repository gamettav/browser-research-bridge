import {
  ActivityDomainSchema,
  isTerminalPhase,
  type ResearchErrorCode,
  type ResearchPhase,
  type SourceCounter
} from "@browser-research/protocol";

export const ACTIVITY_SESSION_KEY = "activityUiState";
export const ACTIVITY_HISTORY_KEY = "activityHistory";
export const MAX_ACTIVITY_HISTORY = 8;

export type ActivityKind = "read" | "search";
export type ActivityOutcome = "completed" | "error" | "login" | "captcha" | "challenge";
export type AttentionKind = "ready" | "error" | "challenge";
export type AttentionSource = "none" | "connection" | "activity";

export type CurrentActivity = {
  id: string;
  kind: ActivityKind;
  domain: string | null;
  phase: ResearchPhase;
  queuedAt: number;
  updatedAt: number;
  source?: SourceCounter;
};

export type ActivityUiState = {
  version: 1;
  activities: CurrentActivity[];
  attention: AttentionKind;
  attentionSource: AttentionSource;
  challengeKind: "login" | "captcha" | "challenge" | null;
};

// This is the complete persisted history schema. Do not add URLs, queries,
// titles, page text, request IDs, or error messages here.
export type ActivityHistoryEntry = {
  domain: string;
  timestamp: number;
  duration: number;
  outcome: ActivityOutcome;
};

export type ActivityProgress = {
  id: string;
  kind: ActivityKind;
  domain: string | null;
  phase: ResearchPhase;
  queuedAt: number;
  elapsedMs: number;
  source?: SourceCounter;
  errorCode?: ResearchErrorCode;
};

export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type ActivityStorage = {
  session: StorageAreaLike;
  local: StorageAreaLike;
};

export class ActivityStateController {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: ActivityStorage,
    private readonly onState: (state: ActivityUiState) => void | Promise<void> = () => undefined
  ) {}

  restore(): Promise<ActivityUiState> {
    return this.enqueue(async () => {
      const state = await readActivityUiState(this.storage.session);
      await this.storage.session.set({ [ACTIVITY_SESSION_KEY]: state });
      await this.onState(state);
      return state;
    });
  }

  record(progress: ActivityProgress): Promise<ActivityUiState> {
    return this.enqueue(async () => {
      const state = await readActivityUiState(this.storage.session);
      const domain = sanitizeDomain(progress.domain);
      if (isTerminalPhase(progress.phase)) {
        state.activities = state.activities.filter((activity) => activity.id !== progress.id);
        const outcome = outcomeFor(progress.phase, progress.errorCode);
        state.attention = outcome === "completed" ? "ready" : isChallengeOutcome(outcome) ? "challenge" : "error";
        state.attentionSource = outcome === "completed" ? "none" : "activity";
        state.challengeKind = outcome === "login" || outcome === "captcha" || outcome === "challenge" ? outcome : null;
        if (domain) {
          await appendHistory(this.storage.local, {
            domain,
            timestamp: Date.now(),
            duration: Math.max(0, Math.round(progress.elapsedMs)),
            outcome
          });
        }
      } else {
        const current: CurrentActivity = {
          id: progress.id,
          kind: progress.kind,
          domain,
          phase: progress.phase,
          queuedAt: positiveTimestamp(progress.queuedAt),
          updatedAt: Date.now(),
          ...(validSource(progress.source) ? { source: progress.source } : {})
        };
        const index = state.activities.findIndex((activity) => activity.id === progress.id);
        if (index >= 0) state.activities[index] = current;
        else state.activities.push(current);
        state.attention = "ready";
        state.attentionSource = "none";
        state.challengeKind = null;
      }
      state.activities.sort((left, right) => right.updatedAt - left.updatedAt);
      await this.storage.session.set({ [ACTIVITY_SESSION_KEY]: state });
      await this.onState(state);
      return state;
    });
  }

  setConnectionError(): Promise<ActivityUiState> {
    return this.enqueue(async () => {
      const state = await readActivityUiState(this.storage.session);
      if (state.attentionSource !== "activity") {
        state.attention = "error";
        state.attentionSource = "connection";
        state.challengeKind = null;
      }
      await this.storage.session.set({ [ACTIVITY_SESSION_KEY]: state });
      await this.onState(state);
      return state;
    });
  }

  setConnectionReady(): Promise<ActivityUiState> {
    return this.enqueue(async () => {
      const state = await readActivityUiState(this.storage.session);
      if (state.attentionSource === "connection") {
        state.attention = "ready";
        state.attentionSource = "none";
        state.challengeKind = null;
      }
      await this.storage.session.set({ [ACTIVITY_SESSION_KEY]: state });
      await this.onState(state);
      return state;
    });
  }

  clearHistory(): Promise<void> {
    return this.enqueue(async () => {
      await this.storage.local.set({ [ACTIVITY_HISTORY_KEY]: [] });
    });
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation);
    this.pending = next.then(() => undefined, () => undefined);
    return next;
  }
}

export function emptyActivityUiState(): ActivityUiState {
  return {
    version: 1,
    activities: [],
    attention: "ready",
    attentionSource: "none",
    challengeKind: null
  };
}

export async function readActivityUiState(storage: StorageAreaLike): Promise<ActivityUiState> {
  const stored = await storage.get(ACTIVITY_SESSION_KEY);
  return sanitizeActivityUiState(stored[ACTIVITY_SESSION_KEY]);
}

export async function readActivityHistory(storage: StorageAreaLike): Promise<ActivityHistoryEntry[]> {
  const stored = await storage.get(ACTIVITY_HISTORY_KEY);
  return sanitizeActivityHistory(stored[ACTIVITY_HISTORY_KEY]);
}

export function sanitizeActivityHistory(value: unknown): ActivityHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ActivityHistoryEntry[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const domain = sanitizeDomain(record.domain);
    const outcome = sanitizeOutcome(record.outcome);
    if (!domain || !outcome || !isFiniteNonnegative(record.timestamp) || !isFiniteNonnegative(record.duration)) return [];
    return [{
      domain,
      timestamp: Math.round(record.timestamp),
      duration: Math.round(record.duration),
      outcome
    }];
  }).slice(0, MAX_ACTIVITY_HISTORY);
}

function sanitizeActivityUiState(value: unknown): ActivityUiState {
  if (!value || typeof value !== "object") return emptyActivityUiState();
  const record = value as Record<string, unknown>;
  const activities = Array.isArray(record.activities)
    ? record.activities.flatMap(sanitizeCurrentActivity).slice(0, 99)
    : [];
  const attention = record.attention === "error" || record.attention === "challenge" ? record.attention : "ready";
  const attentionSource = record.attentionSource === "connection" || record.attentionSource === "activity"
    ? record.attentionSource
    : "none";
  const challengeKind = record.challengeKind === "login" || record.challengeKind === "captcha" || record.challengeKind === "challenge"
    ? record.challengeKind
    : null;
  return { version: 1, activities, attention, attentionSource, challengeKind };
}

function sanitizeCurrentActivity(value: unknown): CurrentActivity[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const phase = sanitizePhase(record.phase);
  if (
    typeof record.id !== "string" || !record.id ||
    (record.kind !== "read" && record.kind !== "search") ||
    !phase || isTerminalPhase(phase) ||
    !isFiniteNonnegative(record.queuedAt) || !isFiniteNonnegative(record.updatedAt)
  ) return [];
  const source = sanitizeSource(record.source);
  return [{
    id: record.id,
    kind: record.kind,
    domain: sanitizeDomain(record.domain),
    phase,
    queuedAt: positiveTimestamp(record.queuedAt),
    updatedAt: positiveTimestamp(record.updatedAt),
    ...(source ? { source } : {})
  }];
}

async function appendHistory(storage: StorageAreaLike, entry: ActivityHistoryEntry): Promise<void> {
  const history = await readActivityHistory(storage);
  await storage.set({ [ACTIVITY_HISTORY_KEY]: [entry, ...history].slice(0, MAX_ACTIVITY_HISTORY) });
}

function outcomeFor(phase: ResearchPhase, errorCode?: ResearchErrorCode): ActivityOutcome {
  if (phase === "completed") return "completed";
  if (errorCode === "requires_login") return "login";
  if (errorCode === "blocked_captcha") return "captcha";
  if (errorCode === "access_denied") return "challenge";
  return "error";
}

function isChallengeOutcome(outcome: ActivityOutcome): boolean {
  return outcome === "login" || outcome === "captcha" || outcome === "challenge";
}

function sanitizeDomain(value: unknown): string | null {
  const parsed = ActivityDomainSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sanitizeOutcome(value: unknown): ActivityOutcome | null {
  return value === "completed" || value === "error" || value === "login" || value === "captcha" || value === "challenge"
    ? value
    : null;
}

function sanitizePhase(value: unknown): ResearchPhase | null {
  return value === "queued" || value === "searching" || value === "navigating" || value === "rendering" ||
    value === "extracting" || value === "completed" || value === "skipped" || value === "failed"
    ? value
    : null;
}

function sanitizeSource(value: unknown): SourceCounter | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.index) || !Number.isInteger(record.total)) return undefined;
  const index = record.index as number;
  const total = record.total as number;
  return index > 0 && total > 0 && index <= total ? { index, total } : undefined;
}

function validSource(value: SourceCounter | undefined): value is SourceCounter {
  return Boolean(value && value.index > 0 && value.total > 0 && value.index <= value.total);
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveTimestamp(value: number): number {
  return Math.max(1, Math.round(value));
}
