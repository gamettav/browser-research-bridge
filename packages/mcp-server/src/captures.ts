import { createHash, randomUUID } from "node:crypto";
import type { PageExtraction } from "@groundtab/protocol";
import { DEFAULT_REDACTED_URL_PARAMETERS } from "./config.js";

export type CaptureBlock = {
  id: string;
  text: string;
};

export type Capture = {
  id: string;
  sessionId: string;
  title: string;
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string | null;
  capturedAt: string;
  contentHash: string;
  blocks: CaptureBlock[];
  links: PageExtraction["links"];
  metadata: Pick<PageExtraction, "siteName" | "byline" | "excerpt" | "language" | "challenge">;
};

export type CaptureStoreOptions = {
  maxCaptures?: number;
  retentionMs?: number;
  doNotRetain?: boolean;
  redactedUrlParameters?: readonly string[];
  now?: () => number;
};

type StoredCapture = {
  capture: Capture;
  retainedAt: number;
};

export type AuditOutcome = "succeeded" | "failed" | "denied" | "cancelled";

export type AuditRecord = {
  id: string;
  sessionId: string;
  operation: "search_web" | "fetch_rendered_page";
  domain: string | null;
  startedAt: string;
  completedAt: string;
  outcome: AuditOutcome;
  errorCode: string | null;
  contentHash: string | null;
  captureId: string | null;
};

export type AuditInput = Omit<AuditRecord, "id" | "completedAt"> & { completedAt?: string };

export class CaptureStore {
  private readonly captures = new Map<string, StoredCapture>();
  private readonly maxCaptures: number;
  private readonly retentionMs: number;
  private readonly doNotRetain: boolean;
  private readonly redactedUrlParameters: readonly string[];
  private readonly now: () => number;

  constructor(options: number | CaptureStoreOptions = 50) {
    const normalized = typeof options === "number" ? { maxCaptures: options } : options;
    this.maxCaptures = normalized.maxCaptures ?? 50;
    this.retentionMs = normalized.retentionMs ?? 0;
    this.doNotRetain = normalized.doNotRetain ?? false;
    this.redactedUrlParameters = normalized.redactedUrlParameters ?? DEFAULT_REDACTED_URL_PARAMETERS;
    this.now = normalized.now ?? Date.now;
    if (!Number.isInteger(this.maxCaptures) || this.maxCaptures < 0) throw new Error("maxCaptures must be a non-negative integer");
    if (!Number.isInteger(this.retentionMs) || this.retentionMs < 0) throw new Error("retentionMs must be a non-negative integer");
  }

  add(page: PageExtraction, sessionId = "unscoped"): Capture {
    this.purgeExpired();
    const capture = createCapture(page, sessionId, this.redactedUrlParameters);
    if (this.doNotRetain || this.maxCaptures === 0) return capture;

    this.captures.set(capture.id, { capture, retainedAt: this.now() });
    while (this.captures.size > this.maxCaptures) {
      const oldest = this.captures.keys().next().value;
      if (typeof oldest !== "string") break;
      this.captures.delete(oldest);
    }
    return capture;
  }

  get(id: string): Capture | undefined {
    this.purgeExpired();
    return this.captures.get(id)?.capture;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  list(): Capture[] {
    this.purgeExpired();
    return [...this.captures.values()].reverse().map(({ capture }) => capture);
  }

  delete(id: string): boolean {
    this.purgeExpired();
    return this.captures.delete(id);
  }

  clear(): number {
    this.purgeExpired();
    const deleted = this.captures.size;
    this.captures.clear();
    return deleted;
  }

  private purgeExpired(): void {
    if (this.retentionMs === 0) return;
    const cutoff = this.now() - this.retentionMs;
    for (const [id, stored] of this.captures) {
      if (stored.retainedAt <= cutoff) this.captures.delete(id);
    }
  }
}

export class AuditLog {
  private readonly records: AuditRecord[] = [];

  constructor(private readonly maxRecords = 1_000) {
    if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error("maxRecords must be a positive integer");
  }

  add(input: AuditInput): AuditRecord {
    const record: AuditRecord = {
      id: randomUUID(),
      completedAt: input.completedAt ?? new Date().toISOString(),
      sessionId: input.sessionId,
      operation: input.operation,
      domain: input.domain,
      startedAt: input.startedAt,
      outcome: input.outcome,
      errorCode: input.errorCode,
      contentHash: input.contentHash,
      captureId: input.captureId
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) this.records.splice(0, this.records.length - this.maxRecords);
    return record;
  }

  list(): AuditRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  clear(): number {
    const deleted = this.records.length;
    this.records.length = 0;
    return deleted;
  }

  exportReport(generatedAt = new Date().toISOString()): {
    generatedAt: string;
    summary: { records: number; sessions: number; outcomes: Record<AuditOutcome, number> };
    sessions: Array<{ sessionId: string; records: AuditRecord[] }>;
  } {
    const sessions = new Map<string, AuditRecord[]>();
    const outcomes: Record<AuditOutcome, number> = { succeeded: 0, failed: 0, denied: 0, cancelled: 0 };
    for (const record of this.records) {
      outcomes[record.outcome] += 1;
      const grouped = sessions.get(record.sessionId) ?? [];
      grouped.push({ ...record });
      sessions.set(record.sessionId, grouped);
    }
    return {
      generatedAt,
      summary: { records: this.records.length, sessions: sessions.size, outcomes },
      sessions: [...sessions].map(([sessionId, records]) => ({ sessionId, records }))
    };
  }
}

export type ResearchGuardLease =
  | { allowed: true; release: () => void }
  | { allowed: false; reason: "page_limit" | "concurrency_limit"; message: string };

export class ResearchRunGuard {
  private activeFetches = 0;
  private readonly sessions = new Map<string, { pages: number; lastSeenAt: number }>();

  constructor(
    private readonly maxPagesPerSession: number,
    private readonly maxConcurrentFetches: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(maxPagesPerSession) || maxPagesPerSession < 1) throw new Error("maxPagesPerSession must be a positive integer");
    if (!Number.isInteger(maxConcurrentFetches) || maxConcurrentFetches < 1) throw new Error("maxConcurrentFetches must be a positive integer");
  }

  begin(sessionId: string): ResearchGuardLease {
    this.purgeIdleSessions();
    const session = this.sessions.get(sessionId) ?? { pages: 0, lastSeenAt: this.now() };
    if (session.pages >= this.maxPagesPerSession) {
      return {
        allowed: false,
        reason: "page_limit",
        message: `Research policy denied another page: session ${sessionId} reached its ${this.maxPagesPerSession}-page limit`
      };
    }
    if (this.activeFetches >= this.maxConcurrentFetches) {
      return {
        allowed: false,
        reason: "concurrency_limit",
        message: `Research policy denied another page: this process already has ${this.maxConcurrentFetches} fetches in flight`
      };
    }

    session.pages += 1;
    session.lastSeenAt = this.now();
    this.sessions.set(sessionId, session);
    this.activeFetches += 1;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.activeFetches -= 1;
      }
    };
  }

  private purgeIdleSessions(): void {
    const cutoff = this.now() - 60 * 60_000;
    for (const [sessionId, state] of this.sessions) {
      if (state.lastSeenAt < cutoff) this.sessions.delete(sessionId);
    }
  }
}

export function createCapture(
  page: PageExtraction,
  sessionId: string,
  redactedUrlParameters: readonly string[] = DEFAULT_REDACTED_URL_PARAMETERS
): Capture {
  return {
    id: randomUUID(),
    sessionId,
    title: page.title,
    requestedUrl: redactUrlParameters(page.requestedUrl, redactedUrlParameters),
    finalUrl: redactUrlParameters(page.finalUrl, redactedUrlParameters),
    canonicalUrl: page.canonicalUrl ? redactUrlParameters(page.canonicalUrl, redactedUrlParameters) : null,
    capturedAt: page.capturedAt,
    contentHash: createHash("sha256").update(page.markdown).digest("hex"),
    blocks: splitBlocks(page.markdown),
    links: page.links.map((link) => ({ ...link, url: redactUrlParameters(link.url, redactedUrlParameters) })),
    metadata: {
      siteName: page.siteName,
      byline: page.byline,
      excerpt: page.excerpt,
      language: page.language,
      challenge: page.challenge
    }
  };
}

export function redactUrlParameters(value: string, parameterNames: readonly string[] = DEFAULT_REDACTED_URL_PARAMETERS): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  const redacted = new Set(parameterNames.map((name) => name.toLowerCase()));
  for (const name of [...parsed.searchParams.keys()]) {
    if (redacted.has(name.toLowerCase())) parsed.searchParams.set(name, "REDACTED");
  }
  return parsed.toString();
}

export function splitBlocks(markdown: string): CaptureBlock[] {
  return markdown
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ id: `B${String(index + 1).padStart(4, "0")}`, text }));
}
