import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const serverPath = process.env.BROWSER_RESEARCH_SERVER_PATH;
if (!serverPath) throw new Error("BROWSER_RESEARCH_SERVER_PATH is required");
const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, BROWSER_RESEARCH_BROKER_IDLE_MS: "1000" },
  stdio: ["pipe", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const lines = createInterface({ input: child.stdout });
const pending = new Map();
lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

try {
  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "browser-research-doctor", version: "0.4.0" }
  });
  if (!initialized?.serverInfo?.name) throw new Error("MCP initialize returned no server information");
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const tools = await request(2, "tools/list", {});
  const names = new Set((tools?.tools ?? []).map((tool) => tool.name));
  for (const expected of ["bridge_status", "search_web", "fetch_rendered_page", "list_captures", "read_capture"]) {
    if (!names.has(expected)) throw new Error(`MCP tool is missing: ${expected}`);
  }
  const statusResult = await request(3, "tools/call", { name: "bridge_status", arguments: {} });
  const statusText = statusResult?.content?.find?.((item) => item?.type === "text")?.text;
  if (typeof statusText !== "string") throw new Error("bridge_status returned no text content");
  const status = JSON.parse(statusText);
  const expectedBuildId = "browser-research-0.4.0-pairing-v3";
  if (status.brokerBuildId !== expectedBuildId) {
    throw new Error(`Broker runtime is stale: expected ${expectedBuildId}, got ${status.brokerBuildId ?? "unknown"}`);
  }
  if (process.env.BROWSER_RESEARCH_REQUIRE_EXTENSION === "1" && status.connected !== true) {
    throw new Error("Browser Research extension is not connected");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, extensionConnected: status.connected === true, brokerBuildId: status.brokerBuildId })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}\n`);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  for (const waiting of pending.values()) waiting.reject(new Error("MCP probe ended"));
}

function request(id, method, params) {
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  send({ jsonrpc: "2.0", id, method, params });
  return Promise.race([
    result,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 5_000))
  ]);
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}
