import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  AuthChallengeSchema,
  BRIDGE_BUILD_ID,
  PROTOCOL_VERSION,
  clientProofPayload,
  hmacSha256Hex
} from "@browser-research/protocol";
import { BrowserBridge } from "../src/bridge.js";

const token = "a".repeat(64);
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
let bridge: BrowserBridge | undefined;

afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

describe("BrowserBridge", () => {
  it("authenticates the extension and completes a browser job", async () => {
    bridge = new BrowserBridge({ token, extensionId, port: 0 });
    await bridge.ready;

    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
      origin: `chrome-extension://${extensionId}`
    });
    const messages: unknown[] = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      messages.push(message);
      if (message.type === "job") {
        socket.send(JSON.stringify({
          type: "job_result",
          id: message.id,
          ok: true,
          result: {
            kind: "search",
            query: "browser bridge",
            provider: "duckduckgo",
            finalUrl: "https://duckduckgo.com/?q=browser%20bridge",
            results: [{ title: "Example", url: "https://example.com/", snippet: "Result" }],
            capturedAt: new Date().toISOString(),
            challenge: false
          }
        }));
      }
    });

    await opened(socket);
    const challenge = AuthChallengeSchema.parse(await waitForMessage(messages, "auth_challenge"));
    socket.send(JSON.stringify({
      type: "auth_response",
      channel: "extension",
      nonce: challenge.nonce,
      protocolVersion: PROTOCOL_VERSION,
      clientId: extensionId,
      clientVersion: "0.1.0",
      clientBuildId: BRIDGE_BUILD_ID,
      proof: await hmacSha256Hex(token, clientProofPayload("extension", challenge.nonce, PROTOCOL_VERSION, extensionId, BRIDGE_BUILD_ID))
    }));
    await waitFor(() => messages.some((message) => isRecord(message) && message.type === "auth_ok"));

    const result = await bridge.runJob({
      kind: "search_web",
      query: "browser bridge",
      provider: "duckduckgo",
      limit: 10,
      timeoutMs: 5_000
    });

    expect(result.ok).toBe(true);
    expect(bridge.getStatus()).toMatchObject({ connected: true, extensionVersion: "0.1.0" });
    socket.close();
  });

  it("synthesizes a queued event and relays extension progress to onProgress", async () => {
    bridge = new BrowserBridge({ token, extensionId, port: 0 });
    await bridge.ready;
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { origin: `chrome-extension://${extensionId}` });
    const messages: unknown[] = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      messages.push(message);
      if (message.type === "job") {
        socket.send(JSON.stringify({ type: "job_progress", id: message.id, phase: "rendering", domain: "example.com", elapsedMs: 15 }));
        socket.send(JSON.stringify({
          type: "job_result",
          id: message.id,
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
        }));
      }
    });

    await opened(socket);
    await authenticateExtension(socket, messages);
    const events: Array<{ phase: string; domain: string | null }> = [];
    const result = await bridge.runJob(
      { kind: "search_web", query: "q", provider: "duckduckgo", limit: 10, timeoutMs: 5_000 },
      (event) => events.push({ phase: event.phase, domain: event.domain })
    );

    expect(result.ok).toBe(true);
    expect(events).toContainEqual({ phase: "queued", domain: "duckduckgo.com" });
    expect(events).toContainEqual({ phase: "rendering", domain: "example.com" });
    socket.close();
  });

  it("rejects connections from the wrong extension origin", async () => {
    bridge = new BrowserBridge({ token, extensionId, port: 0 });
    await bridge.ready;
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
      origin: "https://malicious.example"
    });
    await opened(socket);
    const closeCode = await new Promise<number>((resolve) => socket.once("close", resolve));
    expect(closeCode).toBe(1008);
    expect(bridge.getStatus().connected).toBe(false);
  });

  it("routes originless connections to broker-client authentication", async () => {
    bridge = new BrowserBridge({ token, extensionId, port: 0 });
    let routed = false;
    bridge.onBrokerConnection = ({ socket }) => {
      routed = true;
      socket.close(1000, "test complete");
    };
    await bridge.ready;
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await opened(socket);
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    expect(routed).toBe(true);
  });

  it("does not send the bridge token and rejects a client using the wrong secret", async () => {
    bridge = new BrowserBridge({ token, extensionId, port: 0 });
    await bridge.ready;
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { origin: `chrome-extension://${extensionId}` });
    const messages: unknown[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await opened(socket);
    const challenge = AuthChallengeSchema.parse(await waitForMessage(messages, "auth_challenge"));
    expect(JSON.stringify(challenge)).not.toContain(token);
    const wrongToken = "b".repeat(64);
    socket.send(JSON.stringify({
      type: "auth_response",
      channel: "extension",
      nonce: challenge.nonce,
      protocolVersion: PROTOCOL_VERSION,
      clientId: extensionId,
      clientVersion: "0.4.0",
      clientBuildId: BRIDGE_BUILD_ID,
      proof: await hmacSha256Hex(wrongToken, clientProofPayload("extension", challenge.nonce, PROTOCOL_VERSION, extensionId, BRIDGE_BUILD_ID))
    }));
    const code = await new Promise<number>((resolve) => socket.once("close", resolve));
    expect(code).toBe(1008);
    expect(bridge.getStatus().connected).toBe(false);
  });

  it("validates final navigation URLs through the broker before extraction", async () => {
    bridge = new BrowserBridge({ token, extensionId, port: 0 });
    await bridge.ready;
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { origin: `chrome-extension://${extensionId}` });
    const messages: unknown[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await opened(socket);
    await authenticateExtension(socket, messages);
    const id = crypto.randomUUID();
    socket.send(JSON.stringify({ type: "navigation_check", id, url: "http://127.0.0.1/" }));
    await waitFor(() => messages.some((message) => isRecord(message) && message.type === "navigation_check_result" && message.id === id));
    expect(messages.find((message) => isRecord(message) && message.type === "navigation_check_result" && message.id === id))
      .toMatchObject({ ok: false, error: { code: "blocked_navigation" } });
    socket.close();
  });
});

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for WebSocket message");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForMessage(messages: unknown[], type: string): Promise<unknown> {
  await waitFor(() => messages.some((message) => isRecord(message) && message.type === type));
  return messages.find((message) => isRecord(message) && message.type === type);
}

async function authenticateExtension(socket: WebSocket, messages: unknown[]): Promise<void> {
  const challenge = AuthChallengeSchema.parse(await waitForMessage(messages, "auth_challenge"));
  socket.send(JSON.stringify({
    type: "auth_response",
    channel: "extension",
    nonce: challenge.nonce,
    protocolVersion: PROTOCOL_VERSION,
    clientId: extensionId,
    clientVersion: "0.4.0",
    clientBuildId: BRIDGE_BUILD_ID,
    proof: await hmacSha256Hex(token, clientProofPayload("extension", challenge.nonce, PROTOCOL_VERSION, extensionId, BRIDGE_BUILD_ID))
  }));
  await waitFor(() => messages.some((message) => isRecord(message) && message.type === "auth_ok"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
