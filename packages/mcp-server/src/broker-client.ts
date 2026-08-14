import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  AuthChallengeSchema,
  AuthOkSchema,
  PROTOCOL_VERSION,
  ProtocolErrorSchema,
  clientProofPayload,
  constantTimeHexEqual,
  hmacSha256Hex,
  serverProofPayload,
  type BrowserJob,
  type JobResultMessage,
  type ProgressEvent
} from "@groundtab/protocol";
import { BROKER_BUILD_ID, BROKER_VERSION, BrokerProgressSchema, BrokerResponseSchema, type BrokerResponse, type BrokerStatus } from "./broker-protocol.js";

type PendingRequest = {
  resolve: (response: BrokerResponse) => void;
  reject: (error: Error) => void;
  onProgress: ((event: ProgressEvent) => void) | undefined;
  timer: NodeJS.Timeout;
  cleanup: () => void;
};

export type BrokerClientOptions = {
  token: string;
  extensionId: string | null;
  port: number;
  brokerIdleMs: number;
  brokerPath: string;
  configPath?: string | null;
};

export class BrokerClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<WebSocket> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private closing = false;

  private constructor(private readonly options: BrokerClientOptions) {}

  static async connect(options: BrokerClientOptions): Promise<BrokerClient> {
    const client = new BrokerClient(options);
    await client.ensureConnected();
    return client;
  }

  async getStatus(): Promise<BrokerStatus> {
    const response = await this.request({ operation: "status" }, 5_000);
    if (!response.ok) throw new Error(response.error.message);
    if (!("connected" in response.result)) throw new Error("Broker returned an invalid status response");
    return response.result;
  }

  async runJob(job: BrowserJob, onProgress?: (event: ProgressEvent) => void, signal?: AbortSignal): Promise<JobResultMessage> {
    const response = await this.request({ operation: "run_job", job }, job.timeoutMs + 10_000, onProgress, signal);
    if (!response.ok) throw new Error(response.error.message);
    if (!("type" in response.result) || response.result.type !== "job_result") {
      throw new Error("Broker returned an invalid browser job response");
    }
    return response.result;
  }

  async close(): Promise<void> {
    this.closing = true;
    const socket = this.socket;
    this.socket = null;
    this.rejectPending(new Error("GroundTab MCP client is shutting down"));
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close(1000, "MCP client shutting down");
      setTimeout(resolve, 1_000).unref();
    });
  }

  private async request(
    payload: { operation: "status" } | { operation: "run_job"; job: BrowserJob },
    timeoutMs: number,
    onProgress?: (event: ProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<BrokerResponse> {
    if (signal?.aborted) throw abortError();
    const socket = await this.ensureConnected();
    if (signal?.aborted) throw abortError();
    if (socket.readyState !== WebSocket.OPEN) throw new Error("GroundTab broker disconnected before the request was sent");
    const id = randomUUID();
    const response = new Promise<BrokerResponse>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.cleanup();
        this.pending.delete(id);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "broker_cancel", id }));
        reject(abortError());
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        pending.cleanup();
        this.pending.delete(id);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "broker_cancel", id }));
        reject(new Error(`Broker request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, onProgress, timer, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    socket.send(JSON.stringify({ type: "broker_request", id, ...payload }));
    return response;
  }

  private ensureConnected(): Promise<WebSocket> {
    if (this.closing) return Promise.reject(new Error("GroundTab MCP client is closed"));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = connectWithBrokerStart(this.options)
      .then((socket) => {
        if (this.closing) {
          socket.close(1000, "MCP client closed during reconnect");
          throw new Error("GroundTab MCP client is closed");
        }
        this.attach(socket);
        return socket;
      })
      .finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  private attach(socket: WebSocket): void {
    this.socket = socket;
    socket.on("message", (raw) => {
      let input: unknown;
      try { input = JSON.parse(raw.toString()); } catch {
        this.rejectPending(new Error("Broker sent invalid JSON"));
        return;
      }
      const protocolError = ProtocolErrorSchema.safeParse(input);
      if (protocolError.success) {
        this.rejectPending(new Error(`Broker protocol error (${protocolError.data.code}): ${protocolError.data.message}`));
        return;
      }
      const progress = BrokerProgressSchema.safeParse(input);
      if (progress.success) {
        this.pending.get(progress.data.id)?.onProgress?.(progress.data.event);
        return;
      }
      const parsed = BrokerResponseSchema.safeParse(input);
      if (!parsed.success) {
        this.rejectPending(new Error("Broker sent a schema-invalid response"));
        return;
      }
      const pending = this.pending.get(parsed.data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.cleanup();
      this.pending.delete(parsed.data.id);
      pending.resolve(parsed.data);
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.rejectPending(new Error("GroundTab broker disconnected"));
    });
    socket.on("error", () => undefined);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function abortError(): Error {
  const error = new Error("GroundTab request was cancelled");
  error.name = "AbortError";
  return error;
}

async function connectWithBrokerStart(options: BrokerClientOptions): Promise<WebSocket> {
  try {
    return await connectOnce(options, 1_000);
  } catch (firstError) {
    if (!isBrokerUnavailable(firstError)) throw firstError;
  }

  await startBrokerOnce(options);
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await delay(100);
    try {
      return await connectOnce(options, 1_000);
    } catch (error) {
      lastError = error;
      if (!isBrokerUnavailable(error)) throw error;
    }
  }
  throw new Error(`Could not start GroundTab broker: ${errorMessage(lastError)}`);
}

function connectOnce(options: BrokerClientOptions, timeoutMs: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${options.port}`);
    let settled = false;
    const clientId = randomUUID();
    let challengeAccepted = false;
    const timer = setTimeout(() => finish(new Error("Broker connection timed out")), timeoutMs);
    const onMessage = async (raw: WebSocket.RawData) => {
      let message: unknown;
      try { message = JSON.parse(raw.toString()); } catch {
        finish(new Error("Broker sent invalid JSON during authentication"));
        return;
      }
      const protocolError = ProtocolErrorSchema.safeParse(message);
      if (protocolError.success) {
        finish(new Error(`Broker protocol error (${protocolError.data.code}): ${protocolError.data.message}`));
        return;
      }
      if (!challengeAccepted) {
        const challenge = AuthChallengeSchema.safeParse(message);
        if (!challenge.success || challenge.data.channel !== "broker-client") {
          finish(new Error("Broker sent an invalid authentication challenge"));
          return;
        }
        if (challenge.data.protocolVersion !== PROTOCOL_VERSION) {
          finish(new Error(`Broker protocol mismatch: expected ${PROTOCOL_VERSION}, got ${challenge.data.protocolVersion}`));
          return;
        }
        const expectedServerProof = await hmacSha256Hex(options.token, serverProofPayload(
          "broker-client", challenge.data.nonce, challenge.data.protocolVersion, challenge.data.serverBuildId
        ));
        if (!constantTimeHexEqual(challenge.data.proof, expectedServerProof)) {
          finish(new Error("Broker failed to prove possession of the configured token"));
          return;
        }
        challengeAccepted = true;
        const proof = await hmacSha256Hex(options.token, clientProofPayload(
          "broker-client", challenge.data.nonce, PROTOCOL_VERSION, clientId, BROKER_BUILD_ID
        ));
        socket.send(JSON.stringify({
          type: "auth_response",
          channel: "broker-client",
          nonce: challenge.data.nonce,
          protocolVersion: PROTOCOL_VERSION,
          clientId,
          clientVersion: BROKER_VERSION,
          clientBuildId: BROKER_BUILD_ID,
          proof
        }));
        return;
      }
      const auth = AuthOkSchema.safeParse(message);
      if (!auth.success || auth.data.channel !== "broker-client") {
        finish(new Error("Broker sent an invalid authentication acknowledgement"));
        return;
      }
      if (auth.data.protocolVersion !== PROTOCOL_VERSION) {
        finish(new Error(`Broker protocol mismatch: expected ${PROTOCOL_VERSION}, got ${auth.data.protocolVersion}`));
        return;
      }
      finish(undefined, socket);
    };
    const onClose = (code: number, reason: Buffer) => finish(new Error(`Broker connection closed (${code}): ${reason.toString()}`));
    const onError = (error: Error) => finish(error);
    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);

    function finish(error?: Error, connected?: WebSocket): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
      if (error) {
        socket.close();
        reject(error);
      } else if (connected) {
        resolve(connected);
      }
    }
  });
}

function startBroker(options: BrokerClientOptions): void {
  const child = spawn(process.execPath, [options.brokerPath], {
    detached: true,
    stdio: "ignore",
    env: brokerEnvironment(options)
  });
  child.unref();
}

async function startBrokerOnce(options: BrokerClientOptions): Promise<void> {
  const runtimeRoot = join(tmpdir(), `groundtab-${typeof process.getuid === "function" ? process.getuid() : "user"}`);
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(runtimeRoot, `broker-${options.port}.lock`);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const details = await stat(lockPath).catch(() => null);
    if (details && Date.now() - details.mtimeMs > 15_000) {
      await unlink(lockPath).catch(() => undefined);
      return startBrokerOnce(options);
    }
    return;
  }
  try {
    startBroker(options);
    await delay(250);
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

export function brokerEnvironment(options: BrokerClientOptions, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GROUNDTAB_TOKEN: options.token,
    GROUNDTAB_PORT: String(options.port),
    GROUNDTAB_BROKER_IDLE_MS: String(options.brokerIdleMs)
  };
  if (options.extensionId) environment.GROUNDTAB_EXTENSION_ID = options.extensionId;
  if (options.configPath) environment.GROUNDTAB_CONFIG = options.configPath;
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ"] as const) {
    if (parent[key]) environment[key] = parent[key];
  }
  return environment;
}

function isBrokerUnavailable(error: unknown): boolean {
  return /ECONNREFUSED|connection timed out|closed \(1006\)/i.test(errorMessage(error));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
