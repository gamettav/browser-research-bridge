import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const serverBuild = resolve(root, "packages/mcp-server/dist/index.cjs");
const brokerBuild = resolve(root, "packages/mcp-server/dist/broker.cjs");
const nativeHostBuild = resolve(root, "packages/mcp-server/dist/native-host.cjs");
const nativeHostInstaller = resolve(root, "scripts/install-native-host.mjs");
const lifecycleCommand = resolve(root, "scripts/browser-research.mjs");
const mcpProbe = resolve(root, "scripts/probe-mcp.mjs");
const destinations = [
  resolve(root, "integrations/codex/browser-research/server"),
  resolve(root, "integrations/claude/browser-research/server")
];

for (const destination of destinations) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(serverBuild, resolve(destination, "index.cjs"));
  await cp(brokerBuild, resolve(destination, "broker.cjs"));
  await cp(nativeHostBuild, resolve(destination, "native-host.cjs"));
  await cp(nativeHostInstaller, resolve(destination, "../install-native-host.mjs"));
  await cp(lifecycleCommand, resolve(destination, "../browser-research.mjs"));
  await cp(mcpProbe, resolve(destination, "../probe-mcp.mjs"));
}
