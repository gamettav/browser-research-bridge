import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { BrowserBridge, type BrokerConnection } from "./bridge.js";
import {
  AuthResponseSchema,
  PROTOCOL_VERSION,
  ResearchErrorCodeSchema,
  clientProofPayload,
  constantTimeHexEqual,
  hmacSha256Hex,
  serverProofPayload
} from "@browser-research/protocol";
import { BROKER_BUILD_ID, BROKER_VERSION, BrokerRequestSchema } from "./broker-protocol.js";
import { loadServerConfig } from "./config.js";
import { assertPublicResolvedUrl } from "./dns-policy.js";

const clients = new Set<WebSocket>();
let bridge: BrowserBridge;
let config: Awaited<ReturnType<typeof loadServerConfig>>;
let idleTimer: NodeJS.Timeout | undefined;

async function main(): Promise<void> {
  config = await loadServerConfig();
  bridge = new BrowserBridge(config);
  bridge.onBrokerConnection = authenticateBrokerClient;
  await bridge.ready;
  process.stderr.write(`Browser Research broker running on 127.0.0.1:${bridge.port}\n`);
  scheduleIdleShutdown();
}

function authenticateBrokerClient({ socket }: BrokerConnection): void {
  let authenticated = false;
  const nonce = randomBytes(32).toString("hex");
  const authTimer = setTimeout(() => socket.close(1008, "authentication timeout"), 5_000);

  void hmacSha256Hex(config.token, serverProofPayload("broker-client", nonce, PROTOCOL_VERSION, BROKER_BUILD_ID))
    .then((proof) => send(socket, {
      type: "auth_challenge",
      channel: "broker-client",
      nonce,
      protocolVersion: PROTOCOL_VERSION,
      serverVersion: BROKER_VERSION,
      serverBuildId: BROKER_BUILD_ID,
      proof
    }))
    .catch(() => socket.close(1011, "authentication setup failed"));

  socket.on("message", async (raw) => {
    let input: unknown;
    try { input = JSON.parse(raw.toString()); } catch {
      socket.close(1003, "invalid JSON");
      return;
    }

    if (!authenticated) {
      const parsed = AuthResponseSchema.safeParse(input);
      if (!parsed.success) {
        send(socket, { type: "protocol_error", code: "invalid_auth_response", message: "Expected a valid broker-client authentication response" });
        socket.close(1008, "invalid authentication response");
        return;
      }
      if (parsed.data.channel !== "broker-client" || parsed.data.protocolVersion !== PROTOCOL_VERSION) {
        send(socket, { type: "protocol_error", code: "protocol_mismatch", message: `Broker protocol ${PROTOCOL_VERSION} is required` });
        socket.close(1002, "protocol mismatch");
        return;
      }
      const expectedProof = await hmacSha256Hex(config.token, clientProofPayload(
        "broker-client", nonce, PROTOCOL_VERSION, parsed.data.clientId, parsed.data.clientBuildId
      ));
      if (parsed.data.nonce !== nonce || !constantTimeHexEqual(parsed.data.proof, expectedProof)) {
        socket.close(1008, "authentication failed");
        return;
      }
      authenticated = true;
      clearTimeout(authTimer);
      clients.add(socket);
      bridge.setBrokerClientCount(clients.size);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
      socket.send(JSON.stringify({
        type: "auth_ok",
        channel: "broker-client",
        protocolVersion: PROTOCOL_VERSION,
        serverVersion: BROKER_VERSION,
        serverBuildId: BROKER_BUILD_ID
      }));
      return;
    }

    const request = BrokerRequestSchema.safeParse(input);
    if (!request.success) {
      send(socket, { type: "protocol_error", code: "invalid_broker_request", message: "Broker client sent a schema-invalid request" });
      return;
    }
    void handleRequest(socket, request.data);
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    clients.delete(socket);
    bridge.setBrokerClientCount(clients.size);
    scheduleIdleShutdown();
  });
}

function scheduleIdleShutdown(): void {
  if (clients.size > 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void shutdown(), config.brokerIdleMs);
  idleTimer.unref();
}

async function handleRequest(socket: WebSocket, request: ReturnType<typeof BrokerRequestSchema.parse>): Promise<void> {
  try {
    if (request.operation === "run_job" && request.job.kind === "fetch_rendered_page") {
      await assertPublicResolvedUrl(request.job.url);
    }
    const result = request.operation === "status"
      ? bridge.getStatus()
      : await bridge.runJob(
        request.job,
        { sessionId: request.sessionId, source: request.source },
        (event) => send(socket, { type: "broker_progress", id: request.id, event })
      );
    send(socket, { type: "broker_response", id: request.id, ok: true, result });
  } catch (error) {
    send(socket, {
      type: "broker_response",
      id: request.id,
      ok: false,
      error: { code: brokerErrorCode(error), message: error instanceof Error ? error.message : String(error) }
    });
  }
}

function brokerErrorCode(error: unknown): ReturnType<typeof ResearchErrorCodeSchema.parse> {
  if (error && typeof error === "object" && "code" in error) {
    const parsed = ResearchErrorCodeSchema.safeParse(error.code);
    if (parsed.success) return parsed.data;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("not connected") || message.includes("disconnected")) return "not_connected";
  if (message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (message.includes("public") || message.includes("blocked")) return "blocked_url";
  return "bridge_error";
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function shutdown(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  for (const client of clients) client.close(1001, "broker shutting down");
  await bridge.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
