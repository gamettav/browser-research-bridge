#!/usr/bin/env node
import { access, chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.browser_research.bridge";
const args = parseArgs(process.argv.slice(2));
if (!args.extensionId || !/^[a-p]{32}$/.test(args.extensionId)) {
  fail("Pass --extension-id followed by Chrome's 32-character extension ID (letters a-p only).");
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hostPath = resolveHostPath(args.hostPath, scriptDir);
await access(hostPath, constants.R_OK);
const brokerPath = resolve(dirname(hostPath), "broker.cjs");
await access(brokerPath, constants.R_OK);
const configPath = args.configPath ? resolve(args.configPath) : null;
if (configPath) await access(configPath, constants.R_OK);

const manifestDir = args.manifestDir ? resolve(args.manifestDir) : defaultManifestDir(args.browser);
await mkdir(manifestDir, { recursive: true, mode: 0o700 });
const manifestPath = resolve(manifestDir, `${HOST_NAME}.json`);
const launcherPath = resolve(manifestDir, HOST_NAME);
const runtimeDir = resolve(manifestDir, "browser-research-host");
const installedHostPath = resolve(runtimeDir, "native-host.cjs");
const installedBrokerPath = resolve(runtimeDir, "broker.cjs");
await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
await copyFile(hostPath, installedHostPath);
await copyFile(brokerPath, installedBrokerPath);
await chmod(installedHostPath, 0o600);
await chmod(installedBrokerPath, 0o600);
const configLine = configPath ? `export BROWSER_RESEARCH_CONFIG=${shellQuote(configPath)}\n` : "";
const launcher = `#!/bin/sh\n${configLine}exec ${shellQuote(process.execPath)} ${shellQuote(installedHostPath)} "$@"\n`;
await writeFile(launcherPath, launcher, { mode: 0o700 });
await chmod(launcherPath, 0o700);
const manifest = {
  name: HOST_NAME,
  description: "Browser Research local broker relay",
  path: launcherPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${args.extensionId}/`]
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await chmod(manifestPath, 0o600);
process.stdout.write(`Installed ${HOST_NAME}\nManifest: ${manifestPath}\nLauncher: ${launcherPath}\nHost: ${installedHostPath}\n`);

function resolveHostPath(value, base) {
  if (value) {
    const path = resolve(value);
    if (!isAbsolute(path)) fail("--host-path must resolve to an absolute path");
    return path;
  }
  const sourceTree = resolve(base, "../packages/mcp-server/dist/native-host.cjs");
  const packagedPlugin = resolve(base, "server/native-host.cjs");
  return base.endsWith(`${separator()}scripts`) ? sourceTree : packagedPlugin;
}

function defaultManifestDir(browser = "chrome") {
  const system = platform();
  const names = {
    chrome: system === "darwin" ? ["Library", "Application Support", "Google", "Chrome"] : [".config", "google-chrome"],
    chromium: system === "darwin" ? ["Library", "Application Support", "Chromium"] : [".config", "chromium"],
    "chrome-for-testing": system === "darwin" ? ["Library", "Application Support", "Google", "ChromeForTesting"] : [".config", "google-chrome-for-testing"],
    edge: system === "darwin" ? ["Library", "Application Support", "Microsoft Edge"] : [".config", "microsoft-edge"]
  };
  const parts = names[browser];
  if (!parts) fail("--browser must be chrome, chrome-for-testing, chromium, or edge");
  if (system !== "darwin" && system !== "linux") fail("Automatic native-host installation currently supports macOS and Linux");
  return resolve(homedir(), ...parts, "NativeMessagingHosts");
}

function parseArgs(input) {
  const result = { browser: "chrome" };
  for (let index = 0; index < input.length; index += 1) {
    const key = input[index];
    const value = input[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--extension-id") result.extensionId = value;
    else if (key === "--host-path") result.hostPath = value;
    else if (key === "--manifest-dir") result.manifestDir = value;
    else if (key === "--config-path") result.configPath = value;
    else if (key === "--browser") result.browser = value;
    else fail(`Unknown argument: ${key}`);
    index += 1;
  }
  return result;
}

function separator() {
  return process.platform === "win32" ? "\\" : "/";
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
