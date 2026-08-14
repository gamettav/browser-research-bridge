import { resolve } from "node:path";
import { WebSocket } from "ws";
import { loadServerConfig } from "./config.js";
import { BrokerClient } from "./broker-client.js";
import { NativeMessageDecoder, encodeNativeMessage } from "./native-framing.js";

const CONNECT_TIMEOUT_MS = 2_000;
const STARTUP_TIMEOUT_MS = 8_000;

async function main(): Promise<void> {
  const config = await loadServerConfig();
  const origin = extensionOrigin(process.argv.slice(2));
  const expectedOrigin = `chrome-extension://${config.extensionId}`;
  if (origin !== expectedOrigin) throw new Error(`Native host rejected extension origin ${origin}`);

  // Native Messaging is an OS pipe opened by Chrome only for an origin listed
  // in the host manifest. Bootstrap before connecting to the broker so a new
  // dedicated profile can authenticate on its first launch with no copy/paste.
  process.stdout.write(encodeNativeMessage({
    type: "native_bootstrap_config",
    extensionId: config.extensionId,
    token: config.token,
    port: config.port
  }));

  const socket = await connectOrStartBroker(config, origin);
  const decoder = new NativeMessageDecoder((message) => {
    if (socket.readyState !== WebSocket.OPEN) throw new Error("Broker connection is closed");
    socket.send(JSON.stringify(message));
  });

  process.stdin.on("data", (chunk: Buffer) => {
    try { decoder.push(chunk); } catch (error) { fatal(error); }
  });
  process.stdin.on("end", () => socket.close(1000, "Chrome closed native messaging channel"));
  process.stdin.on("error", fatal);

  socket.on("message", (data) => {
    try {
      const message: unknown = JSON.parse(data.toString());
      process.stdout.write(encodeNativeMessage(message));
    } catch (error) {
      fatal(error);
    }
  });
  socket.on("close", () => process.exit(0));
  socket.on("error", fatal);
}

function extensionOrigin(args: string[]): string {
  const raw = args.find((arg) => arg.startsWith("chrome-extension://"));
  if (!raw) throw new Error("Chrome did not provide an extension origin to the native host");
  return raw.replace(/\/$/, "");
}

async function connectOrStartBroker(config: Awaited<ReturnType<typeof loadServerConfig>>, origin: string): Promise<WebSocket> {
  try {
    return await connectOnce(config.port, origin);
  } catch {
    const starter = await BrokerClient.connect({
      token: config.token,
      extensionId: config.extensionId,
      port: config.port,
      brokerIdleMs: config.brokerIdleMs,
      brokerPath: process.env.GROUNDTAB_BROKER_PATH ?? resolve(__dirname, "broker.cjs")
    });
    await starter.close();
  }

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await delay(100);
    try { return await connectOnce(config.port, origin); } catch (error) { lastError = error; }
  }
  throw new Error(`Could not connect to local broker: ${errorMessage(lastError)}`);
}

function connectOnce(port: number, origin: string): Promise<WebSocket> {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("broker connection timed out")), CONNECT_TIMEOUT_MS);
    socket.once("open", () => finish(undefined, socket));
    socket.once("error", finish);

    function finish(error?: Error, connected?: WebSocket): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("error", finish);
      if (error) {
        socket.close();
        reject(error);
      } else if (connected) {
        resolveSocket(connected);
      }
    }
  });
}

function fatal(error: unknown): void {
  process.stderr.write(`GroundTab native host: ${errorMessage(error)}\n`);
  process.exit(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

void main().catch(fatal);
