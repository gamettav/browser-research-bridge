import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  BRIDGE_BUILD_ID,
  PROTOCOL_VERSION,
  clientProofPayload,
  constantTimeHexEqual,
  hmacSha256Hex,
  serverProofPayload
} from "@browser-research/protocol";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const token = "a".repeat(64);
const port = 63000 + Math.floor(Math.random() * 1_000);
const temporary = await mkdtemp(join(tmpdir(), "browser-research-native-e2e-"));
const configPath = join(temporary, "config.json");
await writeFile(configPath, `${JSON.stringify({ token, extensionId, port, brokerIdleMs: 1_000 })}\n`, { mode: 0o600 });
await chmod("dist/native-host.cjs", 0o755);

const environment = { ...process.env, BROWSER_RESEARCH_CONFIG: configPath };
const native = spawn("dist/native-host.cjs", [`chrome-extension://${extensionId}/`], {
  env: environment,
  stdio: ["pipe", "pipe", "pipe"]
});
let nativeError = "";
native.stderr.on("data", (chunk) => { nativeError += chunk.toString(); });

const nativeMessages = messageStream(native.stdout);
const bootstrap = await nextWithTimeout(nativeMessages, 10_000);
if (bootstrap.type !== "native_bootstrap_config" || bootstrap.extensionId !== extensionId || bootstrap.token !== token || bootstrap.port !== port) {
  throw new Error(`Native relay did not provide the expected bootstrap config: ${JSON.stringify(bootstrap)} ${nativeError}`);
}
const challenge = await nextWithTimeout(nativeMessages, 10_000);
if (challenge.type !== "auth_challenge" || challenge.channel !== "extension") {
  throw new Error(`Native relay did not receive broker challenge: ${JSON.stringify(challenge)} ${nativeError}`);
}
const expectedServerProof = await hmacSha256Hex(token, serverProofPayload(
  "extension", challenge.nonce, challenge.protocolVersion, challenge.serverBuildId
));
if (!constantTimeHexEqual(challenge.proof, expectedServerProof)) throw new Error("Broker challenge proof was invalid");
writeNative(native.stdin, {
  type: "auth_response",
  channel: "extension",
  nonce: challenge.nonce,
  protocolVersion: PROTOCOL_VERSION,
  clientId: extensionId,
  clientVersion: "0.4.1",
  clientBuildId: BRIDGE_BUILD_ID,
  proof: await hmacSha256Hex(token, clientProofPayload("extension", challenge.nonce, PROTOCOL_VERSION, extensionId, BRIDGE_BUILD_ID))
});

const auth = await nextWithTimeout(nativeMessages, 10_000);
if (auth.type !== "auth_ok") throw new Error(`Native auth failed: ${JSON.stringify(auth)} ${nativeError}`);

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.cjs"],
  env: environment,
  stderr: "pipe"
});
transport.stderr?.on("data", () => undefined);
const client = new Client({ name: "native-host-e2e", version: "0.4.1" });

try {
  await client.connect(transport);
  const status = JSON.parse(toolText(await client.callTool({ name: "bridge_status", arguments: {} })));
  if (!status.connected) throw new Error(`Broker did not see the native relay: ${JSON.stringify(status)}`);

  const pendingFetch = client.callTool({
    name: "fetch_rendered_page",
    arguments: { url: "https://example.com/", timeoutMs: 10_000, maxChars: 20_000 }
  });
  const jobMessage = await nextWithTimeout(nativeMessages, 10_000);
  if (jobMessage.type !== "job" || jobMessage.job?.kind !== "fetch_rendered_page") {
    throw new Error(`Native relay did not receive browser job: ${JSON.stringify(jobMessage)}`);
  }

  writeNative(native.stdin, {
    type: "job_result",
    id: jobMessage.id,
    ok: true,
    result: {
      kind: "page",
      requestedUrl: jobMessage.job.url,
      finalUrl: "https://example.com/",
      canonicalUrl: "https://example.com/",
      title: "Native relay acceptance",
      siteName: null,
      byline: null,
      excerpt: "End-to-end native transport acceptance.",
      language: "en",
      markdown: `Native relay ${randomUUID()}`,
      textLength: 49,
      links: [],
      capturedAt: new Date().toISOString(),
      challenge: false
    }
  });
  const fetched = await pendingFetch;
  if (fetched.isError) throw new Error(`MCP fetch through native relay failed: ${toolText(fetched)}`);
  const parsed = JSON.parse(toolText(fetched));
  if (parsed.title !== "Native relay acceptance") throw new Error(`Unexpected fetch result: ${toolText(fetched)}`);

  process.stdout.write(`${JSON.stringify({ nativeBootstrap: true, nativeAuth: true, brokerConnected: true, mcpRoundTrip: true, port }, null, 2)}\n`);
} finally {
  await client.close().catch(() => undefined);
  native.kill("SIGTERM");
  await new Promise((resolve) => native.once("exit", resolve));
  await rm(temporary, { recursive: true, force: true });
}

function writeNative(stream, message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  stream.write(Buffer.concat([header, body]));
}

async function* messageStream(stream) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) break;
      yield JSON.parse(buffer.subarray(4, 4 + length).toString());
      buffer = buffer.subarray(4 + length);
    }
  }
}

async function nextWithTimeout(iterator, timeoutMs) {
  return Promise.race([
    iterator.next().then(({ value, done }) => {
      if (done) throw new Error(`Native host exited early: ${nativeError}`);
      return value;
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Native message timed out: ${nativeError}`)), timeoutMs))
  ]);
}

function toolText(result) {
  const content = result.content?.find((item) => item.type === "text");
  if (!content || typeof content.text !== "string") throw new Error("MCP tool did not return text content");
  return content.text;
}
