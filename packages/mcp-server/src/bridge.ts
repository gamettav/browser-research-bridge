import { randomBytes, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  AuthResponseSchema,
  BRIDGE_BUILD_ID,
  BRIDGE_VERSION,
  HeartbeatMessageSchema,
  JobResultMessageSchema,
  NavigationCheckMessageSchema,
  PROTOCOL_VERSION,
  ProgressEventSchema,
  ProtocolErrorSchema,
  clientProofPayload,
  constantTimeHexEqual,
  hmacSha256Hex,
  isTerminalPhase,
  safeDomain,
  serverProofPayload,
  terminalPhaseForError,
  type BrowserJob,
  type JobResultMessage,
  type ProgressEvent,
  type ResearchContext,
  type ResearchErrorCode
} from "@browser-research/protocol";
import { assertPublicResolvedUrl } from "./dns-policy.js";

type PendingJob = {
  id: string;
  job: BrowserJob;
  context: ResearchContext;
  queuedAt: number;
  domain: string | null;
  deadlineAt: number;
  running: boolean;
  terminalSeen: boolean;
  onProgress: ((event: ProgressEvent) => void) | undefined;
  resolve: (message: JobResultMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function jobDomain(job: BrowserJob): string | null {
  if (job.kind === "fetch_rendered_page") return safeDomain(job.url);
  if (job.provider === "google") return "www.google.com";
  if (job.provider === "bing") return "www.bing.com";
  return "duckduckgo.com";
}

export type BridgeOptions = {
  token: string;
  extensionId: string;
  port: number;
};

export type BrokerConnection = {
  socket: WebSocket;
  request: import("node:http").IncomingMessage;
};

export class BrowserBridge {
  port: number;
  readonly ready: Promise<void>;
  readonly expectedOrigin: string;
  private readonly token: string;
  private readonly server: WebSocketServer;
  private socket: WebSocket | null = null;
  private extensionVersion: string | null = null;
  private connectedAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private readonly pending = new Map<string, PendingJob>();
  private runningJobs = 0;
  private readonly maxParallelJobs = 2;
  private brokerClients = 0;
  onBrokerConnection: ((connection: BrokerConnection) => void) | undefined;

  constructor(options: BridgeOptions) {
    this.port = options.port;
    this.token = options.token;
    this.expectedOrigin = `chrome-extension://${options.extensionId}`;
    this.server = new WebSocketServer({ host: "127.0.0.1", port: this.port });
    this.ready = new Promise((resolve, reject) => {
      this.server.once("listening", () => {
        const address = this.server.address();
        if (typeof address === "object" && address) this.port = address.port;
        resolve();
      });
      this.server.once("error", reject);
    });
    this.server.on("connection", (socket, request) => {
      if (request.headers.origin === this.expectedOrigin) {
        this.authenticate(socket);
      } else if (request.headers.origin === undefined && this.onBrokerConnection) {
        this.onBrokerConnection({ socket, request });
      } else {
        socket.close(1008, "origin rejected");
      }
    });
    this.server.on("listening", () => {
      process.stderr.write(`Browser bridge listening on ws://127.0.0.1:${this.port}\n`);
    });
    this.server.on("error", (error) => {
      process.stderr.write(`Browser bridge error: ${error.message}\n`);
    });
  }

  getStatus() {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN,
      expectedOrigin: this.expectedOrigin,
      port: this.port,
      extensionVersion: this.extensionVersion,
      connectedAt: this.connectedAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      pendingJobs: this.pending.size,
      brokerClients: this.brokerClients,
      brokerVersion: BRIDGE_VERSION,
      brokerBuildId: BRIDGE_BUILD_ID
    };
  }

  setBrokerClientCount(count: number): void {
    this.brokerClients = count;
  }

  async runJob(job: BrowserJob, context: ResearchContext, onProgress?: (event: ProgressEvent) => void): Promise<JobResultMessage> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw researchError("not_connected", "Chrome extension is not connected. Open Chrome and check the Browser Research extension options.");
    }

    const id = randomUUID();
    const timeoutMs = job.timeoutMs + 5_000;
    const queuedAt = Date.now();
    const deadlineAt = queuedAt + timeoutMs;
    const domain = jobDomain(job);
    const result = new Promise<JobResultMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending?.running) this.runningJobs -= 1;
        if (pending) this.emitProgress(pending, "failed", Date.now() - pending.queuedAt, "timeout");
        this.pending.delete(id);
        reject(researchError("timeout", `Browser job timed out after ${timeoutMs}ms`));
        this.pumpJobs();
      }, timeoutMs);
      this.pending.set(id, {
        id,
        job,
        context,
        queuedAt,
        domain,
        deadlineAt,
        running: false,
        terminalSeen: false,
        onProgress,
        resolve,
        reject,
        timer
      });
    });

    // Synthesize the queued event; the extension emits the phases that follow.
    const pending = this.pending.get(id)!;
    this.emitProgress(pending, "queued", 0);
    this.pumpJobs();
    return result;
  }

  async close(): Promise<void> {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.emitProgress(pending, "failed", Date.now() - pending.queuedAt, "bridge_error");
      pending.reject(researchError("bridge_error", "Browser bridge is shutting down"));
      this.pending.delete(id);
    }
    this.socket?.close(1001, "server shutting down");
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private authenticate(socket: WebSocket): void {
    let authenticated = false;
    const nonce = randomBytes(32).toString("hex");
    const authTimer = setTimeout(() => socket.close(1008, "authentication timeout"), 5_000);

    void hmacSha256Hex(this.token, serverProofPayload("extension", nonce, PROTOCOL_VERSION, BRIDGE_BUILD_ID))
      .then((proof) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({
        type: "auth_challenge",
        channel: "extension",
        nonce,
        protocolVersion: PROTOCOL_VERSION,
        serverVersion: BRIDGE_VERSION,
        serverBuildId: BRIDGE_BUILD_ID,
        proof
      })))
      .catch(() => socket.close(1011, "authentication setup failed"));

    socket.on("message", async (raw) => {
      let input: unknown;
      try {
        input = JSON.parse(raw.toString());
      } catch {
        socket.close(1003, "invalid JSON");
        return;
      }

      if (!authenticated) {
        const parsed = AuthResponseSchema.safeParse(input);
        if (!parsed.success) {
          sendProtocolError(socket, "invalid_auth_response", "Expected a valid extension authentication response");
          socket.close(1008, "invalid authentication response");
          return;
        }
        if (parsed.data.channel !== "extension" || parsed.data.protocolVersion !== PROTOCOL_VERSION) {
          sendProtocolError(socket, "protocol_mismatch", `Broker protocol ${PROTOCOL_VERSION} is required`);
          socket.close(1002, "protocol mismatch");
          return;
        }
        if (parsed.data.nonce !== nonce || parsed.data.clientId !== this.expectedOrigin.slice("chrome-extension://".length)) {
          socket.close(1008, "authentication identity mismatch");
          return;
        }
        const expectedProof = await hmacSha256Hex(this.token, clientProofPayload(
          "extension", nonce, PROTOCOL_VERSION, parsed.data.clientId, parsed.data.clientBuildId
        ));
        if (!constantTimeHexEqual(parsed.data.proof, expectedProof)) {
          socket.close(1008, "authentication failed");
          return;
        }

        clearTimeout(authTimer);
        authenticated = true;
        this.socket?.close(1012, "replaced by a new extension connection");
        this.socket = socket;
        this.extensionVersion = parsed.data.clientVersion;
        this.connectedAt = new Date().toISOString();
        this.lastHeartbeatAt = this.connectedAt;
        socket.send(JSON.stringify({
          type: "auth_ok",
          channel: "extension",
          protocolVersion: PROTOCOL_VERSION,
          serverVersion: BRIDGE_VERSION,
          serverBuildId: BRIDGE_BUILD_ID
        }));
        return;
      }

      const heartbeat = HeartbeatMessageSchema.safeParse(input);
      if (heartbeat.success) {
        this.lastHeartbeatAt = new Date().toISOString();
        socket.send(JSON.stringify({ type: "heartbeat_ack", at: heartbeat.data.at }));
        return;
      }

      const progress = ProgressEventSchema.safeParse(input);
      if (progress.success) {
        const pending = this.pending.get(progress.data.id);
        if (!pending) return;
        if (progress.data.sessionId !== pending.context.sessionId || !sameSource(progress.data.source, pending.context.source)) {
          sendProtocolError(socket, "invalid_progress_context", "Extension progress did not match the queued research context");
          this.failPending(pending, "protocol_error", "Extension progress did not match the queued research context");
          this.pumpJobs();
          return;
        }
        if (isTerminalPhase(progress.data.phase)) pending.terminalSeen = true;
        pending.domain = progress.data.domain ?? pending.domain;
        pending.onProgress?.(progress.data);
        return;
      }

      const parsed = JobResultMessageSchema.safeParse(input);
      if (!parsed.success) {
        const navigation = NavigationCheckMessageSchema.safeParse(input);
        if (navigation.success) {
          void assertPublicResolvedUrl(navigation.data.url)
            .then(() => send(socket, { type: "navigation_check_result", id: navigation.data.id, ok: true }))
            .catch((error: unknown) => send(socket, {
              type: "navigation_check_result",
              id: navigation.data.id,
              ok: false,
              error: { code: "blocked_navigation", message: error instanceof Error ? error.message : String(error) }
            }));
          return;
        }
        const protocolError = ProtocolErrorSchema.safeParse(input);
        if (protocolError.success) {
          this.rejectAllPending(
            researchError("protocol_error", `Extension protocol error (${protocolError.data.code}): ${protocolError.data.message}`),
            "protocol_error"
          );
        } else {
          sendProtocolError(socket, "invalid_extension_message", "Extension sent a schema-invalid message");
          this.rejectAllPending(researchError("protocol_error", "Extension sent a schema-invalid message"), "protocol_error");
        }
        return;
      }
      const pending = this.pending.get(parsed.data.id);
      if (!pending) return;
      if (parsed.data.sessionId !== pending.context.sessionId) {
        sendProtocolError(socket, "invalid_result_context", "Extension result did not match the queued research session");
        this.failPending(pending, "protocol_error", "Extension result did not match the queued research session");
        this.pumpJobs();
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(parsed.data.id);
      if (pending.running) this.runningJobs -= 1;
      if (!pending.terminalSeen) {
        if (parsed.data.ok) this.emitProgress(pending, "completed", parsed.data.durationMs);
        else this.emitProgress(
          pending,
          terminalPhaseForError(parsed.data.error.code),
          parsed.data.durationMs,
          parsed.data.error.code
        );
      }
      pending.resolve(parsed.data);
      this.pumpJobs();
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (this.socket === socket) {
        this.socket = null;
        this.extensionVersion = null;
        this.rejectAllPending(
          researchError("not_connected", "Chrome extension disconnected while the browser job was running"),
          "not_connected"
        );
      }
    });
  }

  private pumpJobs(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    for (const pending of this.pending.values()) {
      if (this.runningJobs >= this.maxParallelJobs) return;
      if (pending.running) continue;
      if (Date.now() >= pending.deadlineAt) continue;
      pending.running = true;
      this.runningJobs += 1;
      this.socket.send(JSON.stringify({
        type: "job",
        id: pending.id,
        sessionId: pending.context.sessionId,
        source: pending.context.source,
        queuedAt: pending.queuedAt,
        deadlineAt: pending.deadlineAt,
        job: pending.job
      }));
    }
  }

  private rejectAllPending(error: Error, code: ResearchErrorCode): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.emitProgress(pending, terminalPhaseForError(code), Date.now() - pending.queuedAt, code);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.runningJobs = 0;
  }

  private failPending(pending: PendingJob, code: ResearchErrorCode, message: string): void {
    clearTimeout(pending.timer);
    this.pending.delete(pending.id);
    if (pending.running) this.runningJobs -= 1;
    this.emitProgress(pending, terminalPhaseForError(code), Date.now() - pending.queuedAt, code);
    pending.reject(researchError(code, message));
  }

  private emitProgress(
    pending: PendingJob,
    phase: ProgressEvent["phase"],
    elapsedMs: number,
    errorCode?: ResearchErrorCode
  ): void {
    if (isTerminalPhase(phase)) pending.terminalSeen = true;
    pending.onProgress?.({
      type: "job_progress",
      id: pending.id,
      sessionId: pending.context.sessionId,
      source: pending.context.source,
      phase,
      domain: pending.domain,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      errorCode
    });
  }
}

function sameSource(left: ResearchContext["source"], right: ResearchContext["source"]): boolean {
  if (!left || !right) return left === right;
  return left.index === right.index && left.total === right.total;
}

function researchError(code: ResearchErrorCode, message: string): Error & { code: ResearchErrorCode } {
  return Object.assign(new Error(message), { code });
}

function sendProtocolError(socket: WebSocket, code: string, message: string): void {
  send(socket, { type: "protocol_error", code, message });
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
