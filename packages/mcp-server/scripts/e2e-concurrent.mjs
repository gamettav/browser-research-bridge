import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const configPath = process.env.GROUNDTAB_E2E_CONFIG ?? "/private/tmp/groundtab-e2e-config.json";
const instances = await Promise.all([createClient("codex-simulated"), createClient("claude-simulated")]);

try {
  const deadline = Date.now() + 35_000;
  let statuses = [];
  while (Date.now() < deadline) {
    statuses = await Promise.all(instances.map(({ client }) => status(client)));
    if (statuses.every((value) => value.connected && value.brokerClients >= 2)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!statuses.every((value) => value.connected && value.brokerClients >= 2)) {
    throw new Error(`Two MCP clients did not share one connected broker: ${JSON.stringify(statuses)}`);
  }

  const [staticResult, documentationResult] = await Promise.all([
    fetchPage(instances[0].client, "https://example.com/"),
    fetchPage(instances[1].client, "https://developer.chrome.com/docs/extensions/reference/api/dns")
  ]);

  const blocked = await Promise.all(instances.map(({ client }, index) =>
    client.callTool({
      name: "fetch_rendered_page",
      arguments: {
        url: index === 0 ? "http://127.0.0.1.nip.io/" : "http://[::ffff:127.0.0.1]/",
        timeoutMs: 5_000,
        maxChars: 1_000
      }
    })
  ));
  if (blocked.some((result) => !result.isError)) throw new Error("A concurrent SSRF regression request was not blocked");

  process.stdout.write(`${JSON.stringify({
    broker: { port: statuses[0].port, connectedClients: statuses[0].brokerClients },
    parallelFetches: [staticResult, documentationResult],
    blockedRequests: blocked.length
  }, null, 2)}\n`);
} finally {
  await Promise.all(instances.map(({ client }) => client.close()));
}

async function createClient(name) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.cjs"],
    env: { ...process.env, GROUNDTAB_CONFIG: configPath },
    stderr: "pipe"
  });
  transport.stderr?.on("data", () => undefined);
  const client = new Client({ name, version: "0.1.0" });
  await client.connect(transport);
  return { client, transport };
}

async function status(client) {
  return JSON.parse(toolText(await client.callTool({ name: "bridge_status", arguments: {} })));
}

async function fetchPage(client, url) {
  const result = await callWithOneNavigationRetry(client, url);
  if (result.isError) throw new Error(`Rendered fetch failed for ${url}: ${toolText(result)}`);
  const parsed = JSON.parse(toolText(result));
  if (!parsed.title || !parsed.finalUrl || parsed.totalBlocks < 1) throw new Error(`Incomplete extraction for ${url}`);
  return { requestedUrl: url, finalUrl: parsed.finalUrl, title: parsed.title, totalBlocks: parsed.totalBlocks };
}

async function callWithOneNavigationRetry(client, url) {
  const arguments_ = { url, timeoutMs: 45_000, maxChars: 80_000 };
  const first = await client.callTool({ name: "fetch_rendered_page", arguments: arguments_ });
  if (!first.isError || !toolText(first).includes("showing error page")) return first;
  return client.callTool({ name: "fetch_rendered_page", arguments: arguments_ });
}

function toolText(result) {
  const content = result.content?.find((item) => item.type === "text");
  if (!content || typeof content.text !== "string") throw new Error("MCP tool did not return text content");
  return content.text;
}
