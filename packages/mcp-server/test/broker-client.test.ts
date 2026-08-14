import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import {
  BRIDGE_BUILD_ID,
  PROTOCOL_VERSION,
  clientProofPayload,
  hmacSha256Hex,
  serverProofPayload
} from "@groundtab/protocol";
import { BrokerClient, brokerEnvironment } from "../src/broker-client.js";

const token = "a".repeat(64);

let server: WebSocketServer | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
});

describe("BrokerClient", () => {
  it("authenticates and receives broker status", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    server.on("connection", (socket) => respondAsBroker(socket));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");

    const client = await BrokerClient.connect({
      token,
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      port: address.port,
      brokerIdleMs: 600_000,
      brokerPath: "/unused/broker.cjs"
    });

    await expect(client.getStatus()).resolves.toMatchObject({ connected: true, brokerClients: 2 });
    expect((client as unknown as { socket: WebSocket }).socket.listenerCount("message")).toBe(1);
    await client.close();
  });

  it("relays broker_progress events to the runJob progress callback", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    server.on("connection", (socket) => respondAsBroker(socket));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");

    const client = await BrokerClient.connect(options(address.port));
    const events: Array<{ phase: string; domain: string | null }> = [];
    const result = await client.runJob(
      { kind: "search_web", query: "q", provider: "duckduckgo", limit: 10, timeoutMs: 5_000 },
      (event) => events.push({ phase: event.phase, domain: event.domain })
    );
    expect(result.ok).toBe(true);
    expect(events).toContainEqual({ phase: "rendering", domain: "example.com" });
    await client.close();
  });

  it("propagates harness cancellation to the broker", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const received: Array<Record<string, unknown>> = [];
    server.on("connection", (socket) => {
      socket.on("message", (raw) => received.push(JSON.parse(raw.toString()) as Record<string, unknown>));
      respondAsBroker(socket, { holdJobs: true });
    });
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");

    const client = await BrokerClient.connect(options(address.port));
    const controller = new AbortController();
    const job = client.runJob(
      { kind: "search_web", query: "cancel me", provider: "duckduckgo", limit: 10, timeoutMs: 5_000 },
      undefined,
      controller.signal
    );
    await waitFor(() => received.some((message) => message.type === "broker_request" && message.operation === "run_job"));
    const request = received.find((message) => message.type === "broker_request" && message.operation === "run_job");
    controller.abort();

    await expect(job).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => received.some((message) => message.type === "broker_cancel"));
    expect(received.find((message) => message.type === "broker_cancel")?.id).toBe(request?.id);
    expect((client as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
    await client.close();
  });

  it("accepts a different release version when the wire protocol matches", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    server.on("connection", (socket) => respondAsBroker(socket, { serverVersion: "0.1.0" }));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");

    const client = await BrokerClient.connect({
      token,
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      port: address.port,
      brokerIdleMs: 600_000,
      brokerPath: "/unused/broker.cjs"
    });
    await client.close();
  });

  it("rejects an incompatible wire protocol", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    server.on("connection", (socket) => respondAsBroker(socket, { protocolVersion: 99 }));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");

    await expect(BrokerClient.connect(options(address.port))).rejects.toThrow("Broker protocol mismatch");
  });

  it("reconnects after the broker connection drops", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    let connections = 0;
    let activeSocket: WebSocket | undefined;
    server.on("connection", (socket) => {
      connections += 1;
      activeSocket = socket;
      respondAsBroker(socket);
    });
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");
    const client = await BrokerClient.connect(options(address.port));

    await expect(client.getStatus()).resolves.toMatchObject({ connected: true });
    activeSocket?.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(client.getStatus()).resolves.toMatchObject({ connected: true });
    expect(connections).toBe(2);
    await client.close();
  });

  it("shares one reconnect across simultaneous requests", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    let connections = 0;
    let activeSocket: WebSocket | undefined;
    server.on("connection", (socket) => {
      connections += 1;
      activeSocket = socket;
      respondAsBroker(socket);
    });
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");
    const client = await BrokerClient.connect(options(address.port));
    activeSocket?.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));

    await expect(Promise.all([client.getStatus(), client.getStatus(), client.getStatus()])).resolves.toHaveLength(3);
    expect(connections).toBe(2);
    await client.close();
  });

  it("passes only the broker configuration and essential process variables", () => {
    const environment = brokerEnvironment(options(32189), {
      PATH: "/bin",
      LANG: "en_US.UTF-8",
      SECRET_FROM_HARNESS: "must-not-leak",
      GROUNDTAB_CONFIG: "/private/session/config.json"
    });
    expect(environment).toMatchObject({
      PATH: "/bin",
      LANG: "en_US.UTF-8",
      GROUNDTAB_PORT: "32189"
    });
    expect(environment.SECRET_FROM_HARNESS).toBeUndefined();
    expect(environment.GROUNDTAB_CONFIG).toBeUndefined();
  });

  it("refuses a port squatter that cannot prove possession of the token", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({
        type: "auth_challenge",
        channel: "broker-client",
        nonce: "c".repeat(64),
        protocolVersion: PROTOCOL_VERSION,
        serverVersion: "0.4.2",
        serverBuildId: BRIDGE_BUILD_ID,
        proof: "0".repeat(64)
      }));
    });
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test broker address");
    await expect(BrokerClient.connect(options(address.port))).rejects.toThrow("failed to prove possession");
  });
});

function options(port: number) {
  return {
    token,
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    port,
    brokerIdleMs: 600_000,
    brokerPath: "/unused/broker.cjs"
  };
}

function respondAsBroker(
  socket: WebSocket,
  overrides: { protocolVersion?: number; serverVersion?: string; holdJobs?: boolean } = {}
): void {
  const nonce = "b".repeat(64);
  const protocolVersion = overrides.protocolVersion ?? PROTOCOL_VERSION;
  const serverVersion = overrides.serverVersion ?? "0.4.2";
  void hmacSha256Hex(token, serverProofPayload("broker-client", nonce, protocolVersion, BRIDGE_BUILD_ID)).then((proof) => {
    socket.send(JSON.stringify({
      type: "auth_challenge",
      channel: "broker-client",
      nonce,
      protocolVersion,
      serverVersion,
      serverBuildId: BRIDGE_BUILD_ID,
      proof
    }));
  });
  socket.on("message", async (raw) => {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;
    if (message.type === "auth_response") {
      const expected = await hmacSha256Hex(token, clientProofPayload(
        "broker-client", nonce, PROTOCOL_VERSION, String(message.clientId), String(message.clientBuildId)
      ));
      if (message.proof !== expected) return socket.close(1008, "bad proof");
      socket.send(JSON.stringify({
        type: "auth_ok",
        channel: "broker-client",
        protocolVersion: PROTOCOL_VERSION,
        serverVersion,
        serverBuildId: BRIDGE_BUILD_ID
      }));
      return;
    }
    if (message.type === "broker_request" && message.operation === "status") {
      socket.send(JSON.stringify({
        type: "broker_response",
        id: message.id ?? randomUUID(),
        ok: true,
        result: {
          connected: true,
          expectedOrigin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
          pairingRequired: false,
          pairingCode: null,
          pairingExpiresAt: null,
          pairingAttemptsRemaining: null,
          port: 32189,
          extensionVersion: "0.2.0",
          connectedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
          pendingJobs: 0,
          brokerClients: 2,
          brokerVersion: serverVersion,
          brokerBuildId: BRIDGE_BUILD_ID
        }
      }));
    }
    if (message.type === "broker_request" && message.operation === "run_job") {
      if (overrides.holdJobs) return;
      const id = message.id ?? randomUUID();
      socket.send(JSON.stringify({
        type: "broker_progress",
        id,
        event: { type: "job_progress", id: randomUUID(), phase: "rendering", domain: "example.com", elapsedMs: 12 }
      }));
      socket.send(JSON.stringify({
        type: "broker_response",
        id,
        ok: true,
        result: {
          type: "job_result",
          id: randomUUID(),
          ok: true,
          result: {
            kind: "search",
            query: "q",
            provider: "duckduckgo",
            finalUrl: "https://duckduckgo.com/?q=q",
            results: [],
            capturedAt: new Date().toISOString(),
            challenge: false,
            challengeKind: null
          }
        }
      }));
    }
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for broker message");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
