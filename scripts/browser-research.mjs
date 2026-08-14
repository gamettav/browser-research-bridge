#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, homedir, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.browser_research.bridge";
const CFT_VERSIONS_URL = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
const MAX_CFT_ARCHIVE_BYTES = 500 * 1024 * 1024;
await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  if (command === "install") await install(args);
  else if (command === "open") await openBrowser(args);
  else if (command === "setup") await setup(args);
  else if (command === "doctor") await doctor(args);
  else if (command === "uninstall") await uninstall(args);
  else usage(command ? `Unknown command: ${command}` : undefined);
}

async function install(options) {
  const extensionSource = await resolveExtensionSource(options.extensionPath);
  const extensionId = await extensionIdForManifest(resolve(extensionSource, "manifest.json"));
  const browser = options.browser ?? "chrome-for-testing";
  const browserPath = await resolveBrowserPath(options.browserPath, browser, options.browserRuntimeDir);
  const configPath = resolve(options.configPath ?? defaultConfigPath());
  const profileDir = resolve(options.profileDir ?? defaultProfileDir());
  const manifestDir = resolve(options.manifestDir ?? resolve(profileDir, "NativeMessagingHosts"));
  const installedExtensionPath = resolve(manifestDir, "browser-research-host", "extension");
  const launcherPath = resolve(options.launcherPath ?? defaultBrowserLauncherPath());

  await setup({
    ...options,
    extensionId,
    extensionPath: extensionSource,
    browser,
    browserPath,
    manifestDir,
    profileDir,
    launcherPath,
    quiet: true
  });
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  await createBrowserLauncher({ browserPath, profileDir, extensionPath: installedExtensionPath, launcherPath });

  const config = await readJson(configPath, "configuration");
  await writeFile(configPath, `${JSON.stringify({
    ...config,
    browser,
    browserPath,
    profileDir,
    extensionPath: installedExtensionPath,
    launcherPath
  }, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);

  if (options.noLaunch !== true) launchBrowser({ browserPath, profileDir, extensionPath: installedExtensionPath });
  process.stdout.write("Browser Research is installed.\n");
  process.stdout.write(`Dedicated profile: ${profileDir}\n`);
  process.stdout.write(`Browser launcher: ${displayLauncherPath(launcherPath)}\n`);
  process.stdout.write(options.noLaunch === true
    ? "Run the `open` command when you are ready to start the research browser.\n"
    : "The dedicated research browser is opening; configuration is automatic.\n");
}

async function openBrowser(options) {
  const configPath = resolve(options.configPath ?? defaultConfigPath());
  const config = await readJson(configPath, "configuration");
  const browserPath = resolve(options.browserPath ?? config.browserPath ?? await resolveBrowserPath(undefined, options.browser ?? config.browser ?? "chrome-for-testing", options.browserRuntimeDir));
  const profileDir = resolve(options.profileDir ?? config.profileDir ?? defaultProfileDir());
  const extensionPath = resolve(options.extensionPath ?? config.extensionPath ?? await resolveExtensionSource(undefined));
  launchBrowser({ browserPath, profileDir, extensionPath });
  process.stdout.write(`Opening Browser Research with its dedicated profile: ${profileDir}\n`);
}

async function setup(options) {
  const extensionId = requireExtensionId(options.extensionId);
  const configPath = resolve(options.configPath ?? defaultConfigPath());
  const existing = await readJsonIfPresent(configPath);
  const token = validToken(existing?.token) ? existing.token : randomBytes(32).toString("hex");
  const port = integerOption(options.port, existing?.port, 32189, 1024, 65535, "port");
  const brokerIdleMs = integerOption(options.brokerIdleMs, existing?.brokerIdleMs, 600_000, 1_000, 86_400_000, "broker-idle-ms");

  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify({ ...(existing ?? {}), token, extensionId, port, brokerIdleMs }, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);

  const installer = resolve(dirname(fileURLToPath(import.meta.url)), "install-native-host.mjs");
  const installerArgs = [installer, "--extension-id", extensionId, "--browser", options.browser ?? "chrome", "--config-path", configPath];
  if (options.manifestDir) installerArgs.push("--manifest-dir", resolve(options.manifestDir));
  if (options.hostPath) installerArgs.push("--host-path", resolve(options.hostPath));
  if (options.extensionPath) installerArgs.push("--extension-path", resolve(options.extensionPath));
  const installed = spawnSync(process.execPath, installerArgs, { encoding: "utf8" });
  if (installed.status !== 0) fail(installed.stderr || installed.stdout || "Native host installation failed");

  if (options.quiet !== true) {
    process.stdout.write(`${installed.stdout}\nConfiguration: ${configPath}\n`);
    process.stdout.write(`Extension ID: ${extensionId}\nBridge token (legacy manual setup only): ${token}\nPort: ${port}\n`);
    process.stdout.write("For automatic setup, use the `install` command instead.\n");
  }
}

async function doctor(options) {
  const configPath = resolve(options.configPath ?? defaultConfigPath());
  const config = await readJson(configPath, "configuration");
  const extensionId = requireExtensionId(options.extensionId ?? config.extensionId);
  const browser = options.browser ?? config.browser ?? "chrome";
  const manifestDir = resolve(options.manifestDir ?? (typeof config.profileDir === "string"
    ? resolve(config.profileDir, "NativeMessagingHosts")
    : defaultManifestDir(browser)));
  const manifestPath = resolve(manifestDir, `${HOST_NAME}.json`);
  const launcherPath = resolve(manifestDir, HOST_NAME);
  const runtimeDir = resolve(manifestDir, "browser-research-host");
  const checks = [];

  checks.push(await checkPrivateFile(configPath, "Configuration", 0o077));
  checks.push(validToken(config.token) ? pass("Configuration token is a valid generated 256-bit value") : failure("Configuration token must be exactly 64 lowercase hexadecimal characters generated by setup"));
  checks.push(config.extensionId === extensionId ? pass("Configuration extension ID matches") : failure("Configuration extension ID does not match"));
  checks.push(Number.isInteger(config.port) && config.port >= 1024 && config.port <= 65535 ? pass(`Broker port is ${config.port}`) : failure("Broker port is invalid"));

  const manifest = await readJson(manifestPath, "native host manifest").catch((error) => ({ __error: error.message }));
  if (manifest.__error) checks.push(failure(manifest.__error));
  else {
    checks.push(manifest.name === HOST_NAME ? pass("Native host manifest name is correct") : failure("Native host manifest name is incorrect"));
    checks.push(manifest.path === launcherPath ? pass("Native host launcher path is correct") : failure("Native host launcher path is stale"));
    checks.push(Array.isArray(manifest.allowed_origins) && manifest.allowed_origins.length === 1 && manifest.allowed_origins[0] === `chrome-extension://${extensionId}/`
      ? pass("Native host origin is restricted to the configured extension")
      : failure("Native host allowed_origins does not match the configured extension"));
  }
  checks.push(await checkPrivateFile(launcherPath, "Native host launcher", 0o077));
  checks.push(await checkPrivateFile(resolve(runtimeDir, "native-host.cjs"), "Native host runtime", 0o077));
  checks.push(await checkPrivateFile(resolve(runtimeDir, "broker.cjs"), "Broker runtime", 0o077));
  if (typeof config.extensionPath === "string") checks.push(await checkInstalledExtension(config.extensionPath, extensionId));
  if (typeof config.browserPath === "string") checks.push(await checkExecutable(config.browserPath, "Browser executable"));
  if (typeof config.launcherPath === "string") checks.push(await checkPrivateFile(config.launcherPath, "Dedicated browser launcher", 0o077));
  checks.push(await checkPinnedNodeRuntime(launcherPath));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const sourceRuntimeDir = scriptDir.includes(`${process.platform === "win32" ? "\\" : "/"}integrations${process.platform === "win32" ? "\\" : "/"}`)
    ? resolve(scriptDir, "server")
    : resolve(scriptDir, "../packages/mcp-server/dist");
  checks.push(await checkRuntimeFreshness(resolve(runtimeDir, "native-host.cjs"), resolve(sourceRuntimeDir, "native-host.cjs"), "Native host runtime"));
  checks.push(await checkRuntimeFreshness(resolve(runtimeDir, "broker.cjs"), resolve(sourceRuntimeDir, "broker.cjs"), "Broker runtime"));
  checks.push(await checkMcpRuntime(resolve(runtimeDir, "broker.cjs"), configPath));

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) process.stdout.write(`${check.ok ? "PASS" : "FAIL"}  ${check.message}\n`);
  if (failed.length > 0) fail(`Doctor found ${failed.length} problem${failed.length === 1 ? "" : "s"}.`);
  process.stdout.write("Browser Research local installation is healthy. Configuration is automatic when the dedicated browser opens.\n");
}

async function uninstall(options) {
  const configPath = resolve(options.configPath ?? defaultConfigPath());
  const config = await readJsonIfPresent(configPath);
  const extensionId = requireExtensionId(options.extensionId ?? config?.extensionId);
  const browser = options.browser ?? config?.browser ?? "chrome";
  const manifestDir = resolve(options.manifestDir ?? (typeof config?.profileDir === "string"
    ? resolve(config.profileDir, "NativeMessagingHosts")
    : defaultManifestDir(browser)));
  const manifestPath = resolve(manifestDir, `${HOST_NAME}.json`);
  const launcherPath = resolve(manifestDir, HOST_NAME);
  const runtimeDir = resolve(manifestDir, "browser-research-host");
  const nativeHostPath = resolve(runtimeDir, "native-host.cjs");
  const brokerPath = resolve(runtimeDir, "broker.cjs");
  const installedExtensionPath = resolve(runtimeDir, "extension");
  const manifest = await readJsonIfPresent(manifestPath);

  if (manifest) {
    if (manifest.name !== HOST_NAME || manifest.path !== launcherPath) fail(`Refusing to remove unexpected manifest at ${manifestPath}`);
    if (!Array.isArray(manifest.allowed_origins) || manifest.allowed_origins.length !== 1 || manifest.allowed_origins[0] !== `chrome-extension://${extensionId}/`) {
      fail(`Refusing to remove manifest whose allowed origin does not match ${extensionId}`);
    }
  }

  const removed = [];
  for (const path of [nativeHostPath, brokerPath, launcherPath, manifestPath]) {
    if (await removeRegularFileIfPresent(path)) removed.push(path);
  }
  if (await removeManagedDirectoryIfPresent(installedExtensionPath, runtimeDir)) removed.push(installedExtensionPath);
  const browserLauncherPath = options.launcherPath ?? config?.launcherPath;
  if (browserLauncherPath && await removeRegularFileIfPresent(resolve(browserLauncherPath))) {
    removed.push(resolve(browserLauncherPath));
    await removeEmptyDirectory(dirname(resolve(browserLauncherPath)));
    if (platform() === "darwin" && resolve(browserLauncherPath).includes(`${pathSeparator()}Contents${pathSeparator()}MacOS${pathSeparator()}`)) {
      const contents = dirname(dirname(resolve(browserLauncherPath)));
      if (await removeRegularFileIfPresent(resolve(contents, "Info.plist"))) removed.push(resolve(contents, "Info.plist"));
      await removeEmptyDirectory(dirname(resolve(browserLauncherPath)));
      await removeEmptyDirectory(contents);
      await removeEmptyDirectory(dirname(contents));
    }
  }
  await removeEmptyDirectory(runtimeDir);
  if (options.removeConfig === true && await removeRegularFileIfPresent(configPath)) {
    removed.push(configPath);
    await removeEmptyDirectory(dirname(configPath));
  }

  if (removed.length === 0) process.stdout.write("Browser Research native host was already absent.\n");
  else process.stdout.write(`Removed:\n${removed.map((path) => `- ${path}`).join("\n")}\n`);
  if (options.removeConfig !== true) process.stdout.write(`Kept configuration: ${configPath}\n`);
}

async function resolveExtensionSource(explicit) {
  if (explicit) {
    const path = resolve(explicit);
    await access(resolve(path, "manifest.json"), constants.R_OK);
    return path;
  }
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const candidates = scriptDir.endsWith(`${pathSeparator()}scripts`)
    ? [resolve(scriptDir, "../apps/chrome-extension/dist")]
    : [resolve(scriptDir, "extension")];
  for (const candidate of candidates) {
    try {
      await access(resolve(candidate, "manifest.json"), constants.R_OK);
      return candidate;
    } catch { continue; }
  }
  fail("The built Chrome extension was not found. Run `pnpm build` first or pass --extension-path.");
}

async function extensionIdForManifest(manifestPath) {
  const manifest = await readJson(manifestPath, "extension manifest");
  if (typeof manifest.key !== "string" || manifest.key.length < 100) {
    fail(`Extension manifest does not contain a stable public key: ${manifestPath}`);
  }
  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16);
  const id = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/[0-9a-f]/g, (character) => String.fromCharCode(97 + Number.parseInt(character, 16)));
  return requireExtensionId(id);
}

async function resolveBrowserPath(explicit, browser, explicitRuntimeDir) {
  if (explicit) {
    const path = resolve(explicit);
    await access(path, constants.X_OK).catch(() => fail(`Browser executable is unavailable: ${path}`));
    return path;
  }
  const candidates = browserCandidates(browser);
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { continue; }
  }
  if (browser === "chrome-for-testing") return installChromeForTesting(explicitRuntimeDir);
  fail(`Could not find ${browser}. Install it or pass --browser-path.`);
}

async function installChromeForTesting(explicitRuntimeDir) {
  const runtimeRoot = resolve(explicitRuntimeDir ?? defaultBrowserRuntimeDir(), "chrome-for-testing");
  const currentPath = resolve(runtimeRoot, "current.json");
  const current = await readJsonIfPresent(currentPath);
  if (typeof current?.version === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(current.version)) {
    const executable = chromeForTestingExecutable(resolve(runtimeRoot, current.version));
    try { await access(executable, constants.X_OK); return executable; } catch { /* reinstall below */ }
  }

  const targetPlatform = chromeForTestingPlatform();
  process.stdout.write("Downloading Google's dedicated Chrome for Testing runtime...\n");
  const metadataResponse = await fetch(CFT_VERSIONS_URL, { signal: AbortSignal.timeout(20_000) });
  if (!metadataResponse.ok) fail(`Chrome for Testing metadata returned HTTP ${metadataResponse.status}`);
  const metadataText = await readBoundedResponse(metadataResponse, 2 * 1024 * 1024, "Chrome for Testing metadata");
  let metadata;
  try { metadata = JSON.parse(metadataText); } catch (error) { fail(`Chrome for Testing metadata was invalid JSON: ${error.message}`); }
  const stable = metadata?.channels?.Stable;
  const version = stable?.version;
  const download = stable?.downloads?.chrome?.find((item) => item?.platform === targetPlatform);
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(version) || typeof download?.url !== "string") {
    fail(`Chrome for Testing metadata did not include a Stable ${targetPlatform} download`);
  }
  validateChromeForTestingUrl(download.url, version, targetPlatform);

  const versionDir = resolve(runtimeRoot, version);
  const alreadyInstalled = chromeForTestingExecutable(versionDir);
  try {
    await access(alreadyInstalled, constants.X_OK);
    await writeCurrentChromeForTesting(currentPath, version);
    return alreadyInstalled;
  } catch { /* download below */ }

  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(resolve(runtimeRoot, ".install-"));
  try {
    const archivePath = resolve(staging, "chrome-for-testing.zip");
    const unpackedPath = resolve(staging, "unpacked");
    await mkdir(unpackedPath, { mode: 0o700 });
    const downloadResponse = await fetch(download.url, { signal: AbortSignal.timeout(120_000) });
    if (!downloadResponse.ok) fail(`Chrome for Testing download returned HTTP ${downloadResponse.status}`);
    await downloadBoundedResponse(downloadResponse, archivePath, MAX_CFT_ARCHIVE_BYTES);
    extractZipArchive(archivePath, unpackedPath);

    const extracted = resolve(unpackedPath, `chrome-${targetPlatform}`);
    const extractedExecutable = chromeForTestingExecutable(extracted);
    const details = await lstat(extractedExecutable).catch((error) => fail(`Downloaded Chrome for Testing is incomplete: ${error.message}`));
    if (details.isSymbolicLink() || !details.isFile()) fail("Downloaded Chrome for Testing executable is not a regular file");
    await access(extractedExecutable, constants.X_OK);
    try {
      await rename(extracted, versionDir);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
      await access(alreadyInstalled, constants.X_OK);
    }
    await writeCurrentChromeForTesting(currentPath, version);
    process.stdout.write(`Installed Chrome for Testing ${version}.\n`);
    return chromeForTestingExecutable(versionDir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function chromeForTestingPlatform() {
  if (platform() === "darwin" && arch() === "arm64") return "mac-arm64";
  if (platform() === "darwin" && arch() === "x64") return "mac-x64";
  if (platform() === "linux" && arch() === "x64") return "linux64";
  fail(`Automatic Chrome for Testing installation does not yet support ${platform()} ${arch()}`);
}

function chromeForTestingExecutable(root) {
  if (platform() === "darwin") return resolve(root, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
  return resolve(root, "chrome");
}

function validateChromeForTestingUrl(value, version, targetPlatform) {
  const url = new URL(value);
  const expectedPath = `/chrome-for-testing-public/${version}/${targetPlatform}/chrome-${targetPlatform}.zip`;
  if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com" || url.pathname !== expectedPath || url.search || url.hash) {
    fail(`Chrome for Testing metadata returned an unexpected download URL: ${value}`);
  }
}

async function readBoundedResponse(response, maximumBytes, label) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) fail(`${label} exceeded the ${maximumBytes}-byte limit`);
  const body = await response.arrayBuffer();
  if (body.byteLength > maximumBytes) fail(`${label} exceeded the ${maximumBytes}-byte limit`);
  return Buffer.from(body).toString("utf8");
}

async function downloadBoundedResponse(response, path, maximumBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) fail(`Chrome for Testing archive exceeded the ${maximumBytes}-byte limit`);
  if (!response.body) fail("Chrome for Testing download returned an empty body");
  const file = await open(path, "wx", 0o600);
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > maximumBytes) fail(`Chrome for Testing archive exceeded the ${maximumBytes}-byte limit`);
      await file.write(chunk);
    }
    await file.sync();
  } finally {
    await file.close();
  }
  if (received === 0) fail("Chrome for Testing download returned an empty archive");
}

function extractZipArchive(archivePath, destination) {
  const system = platform();
  const command = system === "darwin" ? "/usr/bin/ditto" : "unzip";
  const args = system === "darwin" ? ["-x", "-k", archivePath, destination] : ["-q", archivePath, "-d", destination];
  const extracted = spawnSync(command, args, { encoding: "utf8", timeout: 120_000 });
  if (extracted.status !== 0) fail(extracted.stderr || extracted.stdout || "Could not extract Chrome for Testing");
}

async function writeCurrentChromeForTesting(path, version) {
  await writeFile(path, `${JSON.stringify({ version }, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function browserCandidates(browser) {
  const system = platform();
  if (system === "darwin") {
    const names = {
      chrome: "Google Chrome.app/Contents/MacOS/Google Chrome",
      chromium: "Chromium.app/Contents/MacOS/Chromium",
      "chrome-for-testing": "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      edge: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    };
    const relative = names[browser];
    if (!relative) fail("--browser must be chrome, chrome-for-testing, chromium, or edge");
    return [resolve("/Applications", relative), resolve(homedir(), "Applications", relative)];
  }
  if (system === "linux") {
    const names = {
      chrome: ["google-chrome", "google-chrome-stable"],
      chromium: ["chromium", "chromium-browser"],
      "chrome-for-testing": ["chrome-for-testing"],
      edge: ["microsoft-edge", "microsoft-edge-stable"]
    };
    const executables = names[browser];
    if (!executables) fail("--browser must be chrome, chrome-for-testing, chromium, or edge");
    return (process.env.PATH ?? "").split(delimiter).flatMap((directory) =>
      directory ? executables.map((name) => resolve(directory, name)) : []
    );
  }
  fail("Automatic research-browser launch currently supports macOS and Linux");
}

async function createBrowserLauncher({ browserPath, profileDir, extensionPath, launcherPath }) {
  await mkdir(dirname(launcherPath), { recursive: true, mode: 0o700 });
  const args = browserArguments(profileDir, extensionPath).map(shellQuote).join(" ");
  await writeFile(launcherPath, `#!/bin/sh\nexec ${shellQuote(browserPath)} ${args} "$@"\n`, { mode: 0o700 });
  await chmod(launcherPath, 0o700);

  if (platform() === "darwin" && launcherPath.includes(".app/Contents/MacOS/")) {
    const contents = dirname(dirname(launcherPath));
    await writeFile(resolve(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Browser Research</string>
  <key>CFBundleDisplayName</key><string>Browser Research</string>
  <key>CFBundleIdentifier</key><string>com.browser-research.launcher</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>${xmlEscape(launcherPath.split(pathSeparator()).at(-1) ?? "Browser Research")}</string>
</dict></plist>\n`, { mode: 0o600 });
  }
}

function launchBrowser({ browserPath, profileDir, extensionPath }) {
  const child = spawn(browserPath, browserArguments(profileDir, extensionPath), {
    detached: true,
    stdio: "ignore"
  });
  child.once("error", (error) => process.stderr.write(`Could not open Browser Research: ${error.message}\n`));
  child.unref();
}

function browserArguments(profileDir, extensionPath) {
  return [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "chrome://newtab/"
  ];
}

function defaultProfileDir() {
  return resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "browser-research", "chrome-profile");
}

function defaultBrowserRuntimeDir() {
  if (platform() === "darwin") return resolve(homedir(), "Library", "Application Support", "Browser Research", "runtime");
  return resolve(process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share"), "browser-research", "runtime");
}

function defaultBrowserLauncherPath() {
  if (platform() === "darwin") return resolve(homedir(), "Applications", "Browser Research.app", "Contents", "MacOS", "Browser Research");
  return resolve(homedir(), ".local", "bin", "browser-research-browser");
}

function displayLauncherPath(launcherPath) {
  const marker = `${pathSeparator()}Contents${pathSeparator()}MacOS${pathSeparator()}`;
  return launcherPath.includes(marker) ? launcherPath.slice(0, launcherPath.indexOf(marker)) : launcherPath;
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function defaultConfigPath() {
  return resolve(process.env.XDG_CONFIG_HOME || resolve(process.env.HOME || homedir(), ".config"), "browser-research", "config.json");
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
  if (system !== "darwin" && system !== "linux") fail("Automatic native-host management currently supports macOS and Linux");
  return resolve(homedir(), ...parts, "NativeMessagingHosts");
}

async function checkPrivateFile(path, label, broadMask) {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isFile()) return failure(`${label} is not a regular file: ${path}`);
    if (platform() !== "win32" && (details.mode & broadMask) !== 0) return failure(`${label} permissions are too broad: ${path}`);
    await access(path, constants.R_OK);
    return pass(`${label} exists with private permissions`);
  } catch (error) {
    return failure(`${label} is unavailable at ${path}: ${error.message}`);
  }
}

async function checkInstalledExtension(path, expectedId) {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isDirectory()) return failure(`Installed extension is not a regular directory: ${path}`);
    const actualId = await extensionIdForManifest(resolve(path, "manifest.json"));
    return actualId === expectedId
      ? pass(`Installed extension has stable ID ${expectedId}`)
      : failure(`Installed extension ID ${actualId} does not match ${expectedId}`);
  } catch (error) {
    return failure(`Installed extension is unavailable at ${path}: ${error.message}`);
  }
}

async function checkExecutable(path, label) {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isFile()) return failure(`${label} is not a regular file: ${path}`);
    await access(path, constants.X_OK);
    return pass(`${label} is available: ${path}`);
  } catch (error) {
    return failure(`${label} is unavailable at ${path}: ${error.message}`);
  }
}

async function checkMcpRuntime(brokerPath, configPath) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(scriptDir, "server", "index.cjs"),
    resolve(scriptDir, "../packages/mcp-server/dist/index.cjs")
  ];
  let serverPath;
  for (const candidate of candidates) {
    try { await access(candidate, constants.R_OK); serverPath = candidate; break; } catch { continue; }
  }
  if (!serverPath) return failure("MCP runtime was not found beside the lifecycle command");

  const probe = spawnSync(process.execPath, [resolve(scriptDir, "probe-mcp.mjs")], {
    encoding: "utf8",
    timeout: 12_000,
    env: {
      ...process.env,
      BROWSER_RESEARCH_CONFIG: configPath,
      BROWSER_RESEARCH_BROKER_PATH: brokerPath,
      BROWSER_RESEARCH_SERVER_PATH: serverPath,
      BROWSER_RESEARCH_BROKER_IDLE_MS: "1000"
    }
  });
  if (probe.status !== 0) {
    const detail = (probe.stderr || probe.stdout || "unknown error").trim();
    const hint = /authentication failed/i.test(detail)
      ? " The configured port may already be occupied by a broker using another token; close old harness sessions or choose another --port."
      : "";
    return failure(`MCP runtime check failed: ${detail}${hint}`);
  }
  return pass("MCP runtime starts and exposes the Browser Research tools");
}

async function checkPinnedNodeRuntime(launcherPath) {
  try {
    const launcher = await readFile(launcherPath, "utf8");
    const match = launcher.match(/^exec '([^']+)' /m);
    if (!match) return failure(`Native host launcher does not contain a recognizable pinned Node executable: ${launcherPath}`);
    const executable = match[1].replaceAll(`'"'"'`, `'`);
    const details = await lstat(executable);
    if (details.isSymbolicLink() || !details.isFile()) return failure(`Pinned Node runtime is not a regular file: ${executable}`);
    await access(executable, constants.X_OK);
    const probe = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 5_000 });
    if (probe.status !== 0) return failure(`Pinned Node runtime cannot launch: ${executable}: ${(probe.stderr || probe.stdout).trim()}`);
    return pass(`Pinned Node runtime launches successfully: ${executable}`);
  } catch (error) {
    return failure(`Pinned Node runtime check failed: ${error.message}`);
  }
}

async function checkRuntimeFreshness(installedPath, sourcePath, label) {
  try {
    const [installed, source] = await Promise.all([readFile(installedPath), readFile(sourcePath)]);
    const digest = (value) => createHash("sha256").update(value).digest("hex");
    return digest(installed) === digest(source)
      ? pass(`${label} matches the current packaged build`)
      : failure(`${label} is stale; re-run setup to refresh ${installedPath}`);
  } catch (error) {
    return failure(`${label} freshness could not be checked: ${error.message}`);
  }
}

async function removeRegularFileIfPresent(path) {
  let details;
  try { details = await lstat(path); } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (details.isSymbolicLink() || !details.isFile()) fail(`Refusing to remove non-regular file: ${path}`);
  await unlink(path);
  return true;
}

async function removeManagedDirectoryIfPresent(path, expectedParent) {
  const target = resolve(path);
  if (dirname(target) !== resolve(expectedParent) || target !== resolve(expectedParent, "extension")) {
    fail(`Refusing to remove unexpected managed directory: ${target}`);
  }
  let details;
  try { details = await lstat(target); } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (details.isSymbolicLink() || !details.isDirectory()) fail(`Refusing to remove non-directory extension runtime: ${target}`);
  await rm(target, { recursive: true });
  return true;
}

async function removeEmptyDirectory(path) {
  try { await rmdir(path); } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
  }
}

async function readJson(path, label) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { throw new Error(`Could not read ${label} at ${path}: ${error.message}`); }
}

async function readJsonIfPresent(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requireExtensionId(value) {
  if (typeof value !== "string" || !/^[a-p]{32}$/.test(value)) fail("Pass --extension-id followed by Chrome's 32-character extension ID (letters a-p only).");
  return value;
}

function validToken(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function integerOption(explicit, existing, fallback, minimum, maximum, name) {
  const value = explicit === undefined ? existing ?? fallback : Number(explicit);
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`--${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

function parseArgs(input) {
  const result = {};
  for (let index = 0; index < input.length; index += 1) {
    const key = input[index];
    if (key === "--remove-config") { result.removeConfig = true; continue; }
    if (key === "--no-launch") { result.noLaunch = true; continue; }
    const value = input[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) fail(`Missing value for ${key}`);
    const property = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[property] = value;
    index += 1;
  }
  return result;
}

function pass(message) { return { ok: true, message }; }
function failure(message) { return { ok: false, message }; }

function usage(error) {
  const help = `Usage:
  browser-research.mjs install [--browser chrome-for-testing] [--browser-path PATH] [--no-launch]
  browser-research.mjs open [--browser chrome-for-testing]
  browser-research.mjs doctor [--browser chrome-for-testing]
  browser-research.mjs uninstall [--browser chrome-for-testing] [--remove-config]

Advanced: --extension-id ID --extension-path PATH --profile-dir PATH --launcher-path PATH --browser-runtime-dir PATH --config-path PATH --manifest-dir PATH --host-path PATH`;
  if (error) throw new Error(`${error}\n${help}`);
  process.stdout.write(`${help}\n`);
}

function fail(message) {
  throw new Error(message.trim());
}
