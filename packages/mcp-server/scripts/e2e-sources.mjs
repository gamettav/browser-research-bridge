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

const client = new Client({ name: "browser-research-source-coverage", version: "0.4.0" });
const summary = {};

try {
  await client.connect(transport);
  await waitForBrowser();

  summary.static = await fetchSuccess("https://example.com/");
  summary.rendered = await fetchSuccess("https://developer.chrome.com/docs/extensions/reference/api/dns");
  summary.crawlerRestricted = await fetchSuccess("https://www.bloomberg.com/technology", 120_000, true);

  const redirect = await fetchSuccess("https://modelcontextprotocol.io/introduction");
  if (redirect.finalUrl === redirect.requestedUrl) throw new Error("Redirect source did not change finalUrl");
  summary.redirect = redirect;

  await fetchSuccess("https://httpbingo.org/cookies/set?bridge_mvp=authorized");
  const cookie = await fetchSuccess("https://httpbingo.org/cookies");
  if (!/bridge\\?_mvp/.test(cookie.text) || !cookie.text.includes("authorized")) {
    throw new Error(`The second browser navigation did not expose the retained session cookie: ${JSON.stringify(cookie.text.slice(0, 500))}`);
  }
  summary.session = { finalUrl: cookie.finalUrl, cookieRetained: true };

  const denied = await client.callTool({
    name: "fetch_rendered_page",
    arguments: {
      url: "https://httpbingo.org/base64/QWNjZXNzIERlbmllZA==",
      timeoutMs: 45_000,
      maxChars: 8_000
    }
  });
  if (!denied.isError || !toolText(denied).includes("access-denied")) {
    throw new Error(`Access-denial fixture was not rejected: ${toolText(denied)}`);
  }
  summary.accessDenial = { detected: true };

  process.stdout.write(`${JSON.stringify(summary, (_key, value) => _key === "text" ? undefined : value, 2)}\n`);
} finally {
  await client.close();
}

async function waitForBrowser() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = JSON.parse(toolText(await client.callTool({ name: "bridge_status", arguments: {} })));
    if (status.connected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome extension did not connect to the MCP bridge");
}

async function fetchSuccess(url, timeoutMs = 45_000, retryTimeout = false) {
  let result = await client.callTool({
    name: "fetch_rendered_page",
    arguments: { url, timeoutMs, maxChars: 20_000 }
  });
  if (retryTimeout && result.isError && /timed out/i.test(toolText(result))) {
    result = await client.callTool({ name: "fetch_rendered_page", arguments: { url, timeoutMs, maxChars: 20_000 } });
  }
  if (result.isError) throw new Error(`Rendered fetch failed for ${url}: ${toolText(result)}`);
  const parsed = JSON.parse(toolText(result));
  if (!parsed.title || !parsed.finalUrl || parsed.totalBlocks < 1) throw new Error(`Incomplete extraction for ${url}`);
  return {
    requestedUrl: url,
    finalUrl: parsed.finalUrl,
    title: parsed.title,
    text: parsed.blocks.map((block) => block.text).join("\n")
  };
}

function toolText(result) {
  const content = result.content?.find((item) => item.type === "text");
  if (!content || typeof content.text !== "string") throw new Error("MCP tool did not return text content");
  return content.text;
}
