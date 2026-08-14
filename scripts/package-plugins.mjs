import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const serverBuild = resolve(root, "packages/mcp-server/dist/index.cjs");
const brokerBuild = resolve(root, "packages/mcp-server/dist/broker.cjs");
const mcpProbe = resolve(root, "scripts/probe-mcp.mjs");
const destinations = [
  resolve(root, "integrations/codex/browser-research/server"),
  resolve(root, "integrations/claude/browser-research/server")
];

for (const destination of destinations) {
  const pluginRoot = resolve(destination, "..");
  await rm(destination, { recursive: true, force: true });
  await rm(resolve(pluginRoot, "extension"), { recursive: true, force: true });
  await rm(resolve(pluginRoot, "install-native-host.mjs"), { force: true });
  await rm(resolve(pluginRoot, "browser-research.mjs"), { force: true });
  await mkdir(destination, { recursive: true });
  await cp(serverBuild, resolve(destination, "index.cjs"));
  await cp(brokerBuild, resolve(destination, "broker.cjs"));
  await cp(mcpProbe, resolve(destination, "../probe-mcp.mjs"));
}
