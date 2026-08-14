import { appendFile, chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "browser-research-lifecycle-"));
const configPath = join(temporary, "config", "config.json");
const manifestDir = join(temporary, "NativeMessagingHosts");
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const port = 50000 + Math.floor(Math.random() * 10_000);
const command = resolve(root, "scripts/browser-research.mjs");
const hostPath = resolve(root, "packages/mcp-server/dist/native-host.cjs");
const common = ["--extension-id", extensionId, "--config-path", configPath, "--manifest-dir", manifestDir, "--port", String(port)];

const automaticRoot = join(temporary, "automatic");
const automaticConfig = join(automaticRoot, "config.json");
const automaticProfile = join(automaticRoot, "profile");
const automaticManifestDir = join(automaticProfile, "NativeMessagingHosts");
const automaticLauncher = join(automaticRoot, "browser-research-browser");
const fakeBrowser = join(automaticRoot, "fake-browser");
await mkdir(automaticRoot, { recursive: true });
await writeFile(fakeBrowser, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
await chmod(fakeBrowser, 0o700);
const automaticInstall = run(
  "install",
  "--config-path", automaticConfig,
  "--profile-dir", automaticProfile,
  "--launcher-path", automaticLauncher,
  "--browser-path", fakeBrowser,
  "--extension-path", resolve(root, "apps/chrome-extension/dist"),
  "--host-path", hostPath,
  "--port", String(port + 1),
  "--no-launch"
);
const automatic = JSON.parse(await readFile(automaticConfig, "utf8"));
if (automatic.extensionId !== "acmkjncjhgcjjlbbfdiehainmlkdgipd") throw new Error("Automatic install did not derive the stable extension ID");
if (automatic.token?.length !== 64) throw new Error("Automatic install did not generate the bridge credential");
if (automatic.browser !== "chrome-for-testing") throw new Error("Automatic install did not select the supported dedicated browser");
if (automaticInstall.stdout.includes(automatic.token)) throw new Error("Automatic install printed the bridge credential");
if (automatic.extensionPath !== join(automaticManifestDir, "browser-research-host", "extension")) throw new Error("Automatic install did not pin its managed extension copy");
await readFile(join(automatic.extensionPath, "manifest.json"), "utf8");
const automaticLauncherContents = await readFile(automaticLauncher, "utf8");
if (!automaticLauncherContents.includes("--load-extension=") || !automaticLauncherContents.includes("--user-data-dir=")) {
  throw new Error("Automatic install did not create a dedicated extension-enabled browser launcher");
}
const automaticDoctor = run(
  "doctor",
  "--config-path", automaticConfig,
  "--host-path", hostPath
);
if (!automaticDoctor.stdout.toLowerCase().includes("configuration is automatic")) throw new Error("Doctor did not recognize the automatic installation");
run("uninstall", "--config-path", automaticConfig);
await expectMissing(join(automaticManifestDir, "com.browser_research.bridge.json"));
await expectMissing(automaticLauncher);
await readFile(automaticConfig, "utf8");
run("uninstall", "--config-path", automaticConfig, "--remove-config");
await expectMissing(automaticConfig);

run("setup", ...common, "--host-path", hostPath);
const first = JSON.parse(await readFile(configPath, "utf8"));
if (typeof first.token !== "string" || first.token.length !== 64) throw new Error("Setup did not generate a 32-byte token");
if ((await stat(configPath)).mode & 0o077) throw new Error("Configuration permissions are too broad");

run("setup", ...common, "--host-path", hostPath);
const second = JSON.parse(await readFile(configPath, "utf8"));
if (second.token !== first.token) throw new Error("Idempotent setup rotated the existing token");

const doctor = run("doctor", ...common);
if (!doctor.stdout.includes("local installation is healthy")) throw new Error("Doctor did not report a healthy installation");

const installedBroker = join(manifestDir, "browser-research-host", "broker.cjs");
await appendFile(installedBroker, "\n// stale-test\n");
const staleDoctor = runFailure("doctor", ...common);
if (!staleDoctor.stdout.includes("Broker runtime is stale")) throw new Error("Doctor did not identify a stale broker runtime");
run("setup", ...common, "--host-path", hostPath);

const launcherPath = join(manifestDir, "com.browser_research.bridge");
const launcher = await readFile(launcherPath, "utf8");
await writeFile(launcherPath, launcher.replace(process.execPath, join(temporary, "missing-node")), { mode: 0o700 });
const brokenNodeDoctor = runFailure("doctor", ...common);
if (!brokenNodeDoctor.stdout.includes("Pinned Node runtime check failed")) throw new Error("Doctor did not identify a missing pinned Node runtime");
run("setup", ...common, "--host-path", hostPath);

run("uninstall", ...common);
await expectMissing(join(manifestDir, "com.browser_research.bridge.json"));
await readFile(configPath, "utf8");
run("uninstall", ...common, "--remove-config");
await expectMissing(configPath);

process.stdout.write(`${JSON.stringify({ automaticInstall: true, stableExtensionId: true, noTokenPaste: true, automaticUninstall: true, setup: true, idempotent: true, doctor: true, staleRuntimeDetected: true, brokenNodeDetected: true, uninstall: true }, null, 2)}\n`);

function run(...args) {
  const result = spawnSync(process.execPath, [command, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Command failed (${args[0]}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

function runFailure(...args) {
  const result = spawnSync(process.execPath, [command, ...args], { encoding: "utf8" });
  if (result.status === 0) throw new Error(`Command unexpectedly passed (${args[0]})`);
  return result;
}

async function expectMissing(path) {
  try {
    await stat(path);
    throw new Error(`Expected path to be absent: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
