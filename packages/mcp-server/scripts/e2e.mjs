import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const configPath = process.env.BROWSER_RESEARCH_E2E_CONFIG ?? "/private/tmp/vebicrolly-browser-research-config.json";
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.cjs"],
  env: { ...process.env, BROWSER_RESEARCH_CONFIG: configPath },
  stderr: "pipe"
});
transport.stderr?.on("data", () => undefined);

const client = new Client({ name: "browser-research-e2e", version: "0.1.0" });
const summary = { connected: false, fetches: [], search: null, blockedUrls: [] };

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const expectedTools = ["bridge_status", "search_web", "fetch_rendered_page", "list_captures", "read_capture"];
  for (const name of expectedTools) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`MCP tool is missing: ${name}`);
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = parseToolJson(await client.callTool({ name: "bridge_status", arguments: {} }));
    if (status.connected) {
      summary.connected = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!summary.connected) throw new Error("Chrome extension did not connect to the MCP bridge");

  for (const url of [
    "https://example.com/",
    "https://developer.chrome.com/docs/extensions/reference/api/dns"
  ]) {
    const result = await callWithOneNavigationRetry(client, url);
    if (result.isError) throw new Error(`Rendered fetch failed for ${url}: ${toolText(result)}`);
    const parsed = parseToolJson(result);
    if (!parsed.title || !parsed.finalUrl || parsed.totalBlocks < 1) throw new Error(`Incomplete extraction for ${url}`);
    summary.fetches.push({ requestedUrl: url, finalUrl: parsed.finalUrl, title: parsed.title, totalBlocks: parsed.totalBlocks });
  }

  const searchResult = await client.callTool({
    name: "search_web",
    arguments: { query: "Model Context Protocol official documentation", provider: "duckduckgo", limit: 5, timeoutMs: 45_000 }
  });
  if (searchResult.isError) throw new Error(`Browser search failed: ${toolText(searchResult)}`);
  const parsedSearch = parseToolJson(searchResult);
  if (!Array.isArray(parsedSearch.results) || parsedSearch.results.length < 1) throw new Error("Browser search returned no results");
  summary.search = { provider: parsedSearch.provider, resultCount: parsedSearch.results.length };

  for (const url of [
    "http://127.0.0.1.nip.io/",
    "http://[::ffff:127.0.0.1]/",
    "http://metadata.google.internal/"
  ]) {
    const blocked = await client.callTool({
      name: "fetch_rendered_page",
      arguments: { url, timeoutMs: 5_000, maxChars: 1_000 }
    });
    if (!blocked.isError) throw new Error(`SSRF regression URL was not blocked: ${url}`);
    summary.blockedUrls.push(url);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await client.close();
}

function parseToolJson(result) {
  return JSON.parse(toolText(result));
}

function toolText(result) {
  const content = result.content?.find((item) => item.type === "text");
  if (!content || typeof content.text !== "string") throw new Error("MCP tool did not return text content");
  return content.text;
}

async function callWithOneNavigationRetry(client, url) {
  const arguments_ = { url, timeoutMs: 45_000, maxChars: 80_000 };
  const first = await client.callTool({ name: "fetch_rendered_page", arguments: arguments_ });
  if (!first.isError || !toolText(first).includes("showing error page")) return first;
  return client.callTool({ name: "fetch_rendered_page", arguments: arguments_ });
}
