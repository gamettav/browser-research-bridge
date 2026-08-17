import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import {
  AuthChallengeSchema,
  AuthOkSchema,
  BRIDGE_BUILD_ID,
  PROTOCOL_VERSION,
  PairingOkSchema,
  PairingRequiredSchema,
  clientProofPayload,
  constantTimeHexEqual,
  hmacSha256Hex,
  pairingOkPayload,
  pairingProofHex,
  pairingSubmitPayload,
  serverProofPayload
} from "@groundtab/protocol";

const directory = await mkdtemp(join(tmpdir(), "groundtab-pairing-e2e-"));
const configPath = join(directory, "config.json");
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const bridgePort = await availablePort();
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.cjs"],
  env: {
    ...process.env,
    GROUNDTAB_CONFIG: configPath,
    GROUNDTAB_PORT: String(bridgePort),
    GROUNDTAB_BROKER_IDLE_MS: "1000"
  },
  stderr: "pipe"
});
transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
const client = new Client({ name: "groundtab-pairing-e2e", version: "0.4.3" });

try {
  await client.connect(transport);
  const firstStatus = parseToolJson(await client.callTool({ name: "bridge_status", arguments: {} }));
  if (!firstStatus.pairingRequired || !firstStatus.pairingCode || firstStatus.connected) {
    throw new Error("Fresh MCP startup did not return a pairing code");
  }

  const pairingSocket = await openExtensionSocket(firstStatus.port);
  const pairingMessages = collectMessages(pairingSocket);
  send(pairingSocket, hello(false));
  const required = PairingRequiredSchema.parse(await waitForType(pairingMessages, "pairing_required"));
  const submit = {
    type: "pairing_submit",
    nonce: required.nonce,
    proof: await pairingProofHex(
      firstStatus.pairingCode,
      pairingSubmitPayload(required.nonce, extensionId, PROTOCOL_VERSION)
    )
  };
  if (JSON.stringify(submit).includes(firstStatus.pairingCode)) throw new Error("Pairing code crossed the loopback socket");
  send(pairingSocket, submit);
  const paired = PairingOkSchema.parse(await waitForType(pairingMessages, "pairing_ok"));
  const expectedPairingProof = await pairingProofHex(
    firstStatus.pairingCode,
    pairingOkPayload(paired.nonce, paired.token, paired.port, extensionId, PROTOCOL_VERSION)
  );
  if (!constantTimeHexEqual(paired.proof, expectedPairingProof)) throw new Error("Broker pairing proof did not verify");
  pairingSocket.close();

  const authenticatedSocket = await openExtensionSocket(firstStatus.port);
  const authenticatedMessages = collectMessages(authenticatedSocket);
  send(authenticatedSocket, hello(true));
  const challenge = AuthChallengeSchema.parse(await waitForType(authenticatedMessages, "auth_challenge"));
  const expectedServerProof = await hmacSha256Hex(
    paired.token,
    serverProofPayload("extension", challenge.nonce, PROTOCOL_VERSION, challenge.serverBuildId)
  );
  if (!constantTimeHexEqual(challenge.proof, expectedServerProof)) throw new Error("Broker authentication proof did not verify");
  send(authenticatedSocket, {
    type: "auth_response",
    channel: "extension",
    nonce: challenge.nonce,
    protocolVersion: PROTOCOL_VERSION,
    clientId: extensionId,
    clientVersion: "0.4.3",
    clientBuildId: BRIDGE_BUILD_ID,
    proof: await hmacSha256Hex(
      paired.token,
      clientProofPayload("extension", challenge.nonce, PROTOCOL_VERSION, extensionId, BRIDGE_BUILD_ID)
    )
  });
  AuthOkSchema.parse(await waitForType(authenticatedMessages, "auth_ok"));

  const connected = parseToolJson(await client.callTool({ name: "bridge_status", arguments: {} }));
  if (!connected.connected || connected.expectedOrigin !== `chrome-extension://${extensionId}` || connected.pairingCode !== null) {
    throw new Error("Paired extension did not become the authenticated bridge connection");
  }
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  if (saved.extensionId !== extensionId || saved.token !== paired.token) throw new Error("Pairing was not persisted");
  if (process.platform !== "win32" && ((await stat(configPath)).mode & 0o077) !== 0) {
    throw new Error("Generated configuration is readable outside its owner");
  }
  authenticatedSocket.close();
  process.stdout.write(`${JSON.stringify({ ok: true, paired: true, connected: true, credentialPrinted: false })}\n`);
} finally {
  await client.close().catch(() => undefined);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_250));
  const tempRoot = resolve(tmpdir()) + sep;
  const resolvedDirectory = resolve(directory);
  if (!resolvedDirectory.startsWith(tempRoot) || !basename(resolvedDirectory).startsWith("groundtab-pairing-e2e-")) {
    throw new Error("Refusing to remove an unexpected pairing test directory");
  }
  await rm(resolvedDirectory, { recursive: true, force: true });
}

function hello(hasToken) {
  return { type: "extension_hello", extensionId, hasToken, clientVersion: "0.4.3", clientBuildId: BRIDGE_BUILD_ID };
}

async function openExtensionSocket(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${extensionId}` });
  await new Promise((resolveOpen, reject) => {
    socket.once("open", resolveOpen);
    socket.once("error", reject);
  });
  return socket;
}

function collectMessages(socket) {
  const messages = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  return messages;
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

async function waitForType(messages, type) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const match = messages.find((message) => message?.type === type);
    if (match) return match;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Timed out waiting for ${type}`);
}

function parseToolJson(result) {
  const content = result.content?.find((item) => item.type === "text");
  if (!content || typeof content.text !== "string") throw new Error("MCP tool returned no JSON text");
  return JSON.parse(content.text);
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback test port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}
