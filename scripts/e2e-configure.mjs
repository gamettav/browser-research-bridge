import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";

const debuggerPort = Number(process.env.BROWSER_RESEARCH_CDP_PORT ?? 9223);
const bridgePort = Number(process.env.BROWSER_RESEARCH_PORT ?? 32189);
const configPath = process.env.BROWSER_RESEARCH_E2E_CONFIG ?? "/private/tmp/vebicrolly-browser-research-config.json";
const targets = await fetch(`http://127.0.0.1:${debuggerPort}/json/list`).then((response) => response.json());
const optionsTarget = targets.find(
  (target) => target.type === "page" && /^chrome-extension:\/\/[^/]+\/options\.html$/.test(target.url)
);
if (!optionsTarget) throw new Error("GroundTab extension options page was not found in the E2E Chrome profile");

const extensionId = new URL(optionsTarget.url).hostname;
const token = await existingToken(configPath) ?? randomBytes(32).toString("hex");
const socket = new WebSocket(optionsTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (typeof message.id !== "number") return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

if (!Number.isInteger(bridgePort) || bridgePort < 1024 || bridgePort > 65535) throw new Error("BROWSER_RESEARCH_PORT is invalid");
const configuration = { token, port: bridgePort };
const evaluation = await cdp("Runtime.evaluate", {
  expression: `chrome.storage.local.set(${JSON.stringify(configuration)}).then(() => chrome.runtime.sendMessage({ type: "config_updated" })).then(() => true)`,
  awaitPromise: true,
  returnByValue: true
});
if (evaluation.exceptionDetails || evaluation.result?.value !== true) {
  throw new Error("Chrome rejected the extension configuration");
}

await writeFile(configPath, `${JSON.stringify({ token, extensionId, port: bridgePort }, null, 2)}\n`, { mode: 0o600 });
await chmod(configPath, 0o600);
let connectionStatus = null;
const statusDeadline = Date.now() + 10_000;
while (Date.now() < statusDeadline) {
  const statusEvaluation = await cdp("Runtime.evaluate", {
    expression: "chrome.storage.local.get('connectionStatus').then(value => value.connectionStatus ?? null)",
    awaitPromise: true,
    returnByValue: true
  });
  connectionStatus = statusEvaluation.result?.value ?? null;
  if (connectionStatus?.connected) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
socket.close();
process.stdout.write(`${JSON.stringify({ extensionId, configPath, debuggerPort, connectionStatus })}\n`);

async function existingToken(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed.token === "string" && /^[0-9a-f]{64}$/.test(parsed.token) ? parsed.token : null;
  } catch {
    return null;
  }
}
