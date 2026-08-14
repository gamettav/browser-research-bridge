#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = resolve(import.meta.dirname, "..");
const iterations = integerSetting(process.env.GROUNDTAB_BENCH_ITERATIONS, 25, 5, 200);
const warmups = integerSetting(process.env.GROUNDTAB_BENCH_WARMUPS, 5, 1, 50);

async function main() {
const temporary = await mkdtemp(join(tmpdir(), "groundtab-benchmark-"));
const server = createFixtureServer();
let browser;
let cdp;

try {
  const address = await listen(server);
  const origin = `http://127.0.0.1:${address.port}`;
  const executable = await browserExecutable();
  const launched = await launchBrowser(executable, temporary);
  browser = launched.child;
  cdp = await CdpClient.connect(launched.webSocketUrl);

  const [staticBundle, renderedBundle] = await Promise.all([
    readFile(resolve(root, "apps/chrome-extension/dist/static-extractor.js"), "utf8"),
    readFile(resolve(root, "apps/chrome-extension/dist/extractor.js"), "utf8")
  ]);

  const staticTarget = await attachTarget(cdp, `${origin}/blank`);
  await installExtractor(cdp, staticTarget.sessionId, staticBundle);

  const staticRuns = [];
  const renderedRuns = [];
  let expectedChars = null;

  for (let index = 0; index < warmups + iterations; index += 1) {
    const result = await benchmarkStatic(cdp, staticTarget.sessionId, `${origin}/article?run=${index}`);
    expectedChars ??= result.textLength;
    assertUsefulExtraction(result, expectedChars, "static");
    if (index >= warmups) staticRuns.push(result.ms);
  }

  for (let index = 0; index < warmups + iterations; index += 1) {
    const result = await benchmarkRendered(cdp, `${origin}/app?run=${index}`, renderedBundle);
    assertUsefulExtraction(result, expectedChars, "rendered");
    if (index >= warmups) renderedRuns.push(result.ms);
  }

  await cdp.send("Target.closeTarget", { targetId: staticTarget.targetId });
  const staticSummary = summarize(staticRuns);
  const renderedSummary = summarize(renderedRuns);
  const speedup = renderedSummary.median / staticSummary.median;
  const version = spawnSync(executable, ["--version"], { encoding: "utf8" }).stdout.trim() || executable;
  const articleBytes = Buffer.byteLength(articleHtml());

  process.stdout.write([
    "# GroundTab fetch benchmark",
    "",
    `Local ${articleBytes.toLocaleString("en-US")}-byte article · ${iterations} measured runs after ${warmups} warmups`,
    `Runtime: ${version} · Node ${process.version} · ${platform()} ${process.arch} · ${cpus()[0]?.model ?? "unknown CPU"}`,
    "",
    "| Path | Median | p95 | Extracted chars |",
    "| --- | ---: | ---: | ---: |",
    `| Static extension-context fetch | ${milliseconds(staticSummary.median)} | ${milliseconds(staticSummary.p95)} | ${expectedChars.toLocaleString("en-US")} |`,
    `| Rendered inactive tab | ${milliseconds(renderedSummary.median)} | ${milliseconds(renderedSummary.p95)} | ${expectedChars.toLocaleString("en-US")} |`,
    "",
    `Static fetch was ${speedup.toFixed(1)}× faster at the median in this local fixture.`,
    "",
    "The fixture removes network variance. It measures browser fetch, the packaged GroundTab extractors, tab creation, DOM settling, and cleanup; it is not a claim about arbitrary website load time.",
    ""
  ].join("\n"));
} finally {
  await cdp?.send("Browser.close").catch(() => undefined);
  if (browser && !(await waitForExit(browser, 5_000))) {
    browser.kill("SIGTERM");
    if (!(await waitForExit(browser, 5_000))) throw new Error("Benchmark browser did not shut down cleanly");
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!temporary.startsWith(`${tmpdir()}/groundtab-benchmark-`)) {
    throw new Error(`Refusing to clean unexpected benchmark directory: ${temporary}`);
  }
  await rm(temporary, { recursive: true, force: true });
}
}

function createFixtureServer() {
  return createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.url?.startsWith("/article")) {
      response.end(articleHtml());
      return;
    }
    if (request.url?.startsWith("/app")) {
      response.end(`<!doctype html><html><head><title>GroundTab benchmark article</title></head><body><main id="root"></main><script>document.querySelector('#root').outerHTML = ${JSON.stringify(articleBody())};</script></body></html>`);
      return;
    }
    response.end("<!doctype html><html><body></body></html>");
  });
}

function articleHtml() {
  return `<!doctype html><html lang="en"><head><title>GroundTab benchmark article</title><meta name="description" content="Local extraction fixture"><link rel="canonical" href="/article"></head><body>${articleBody()}</body></html>`;
}

function articleBody() {
  const paragraphs = Array.from({ length: 80 }, (_, index) =>
    `<p>GroundTab benchmark paragraph ${index + 1}. Independent evidence, technical details, and citation-ready source text stay readable after extraction.</p>`
  ).join("");
  return `<main><article><h1>GroundTab benchmark article</h1>${paragraphs}<p><a href="/source-a">Primary source</a> · <a href="/source-b">Independent source</a></p></article></main>`;
}

async function benchmarkStatic(client, sessionId, url) {
  const expression = `(async () => {
    const started = performance.now();
    const response = await fetch(${JSON.stringify(url)}, { credentials: "include", cache: "no-store" });
    const html = await response.text();
    const result = await new Promise((resolve, reject) => {
      try {
        globalThis.__groundtabExtractor({ type: "extract_static_page", requestedUrl: ${JSON.stringify(url)}, finalUrl: response.url, html, maxChars: 50000 }, null, resolve);
      } catch (error) { reject(error); }
    });
    return { ms: performance.now() - started, textLength: result.textLength, title: result.title };
  })()`;
  return evaluate(client, sessionId, expression);
}

async function benchmarkRendered(client, url, bundle) {
  const started = performance.now();
  const target = await attachTarget(client, "about:blank", false);
  try {
    const loaded = client.waitFor("Page.loadEventFired", target.sessionId, 5_000);
    await client.send("Page.navigate", { url }, target.sessionId);
    await loaded;
    await settleDom(client, target.sessionId);
    await installExtractor(client, target.sessionId, bundle);
    const result = await evaluate(client, target.sessionId, `(async () => new Promise((resolve, reject) => {
      try {
        globalThis.__groundtabExtractor({ type: "extract_page", requestedUrl: ${JSON.stringify(url)}, maxChars: 50000 }, null, resolve);
      } catch (error) { reject(error); }
    }))()`);
    return { ms: performance.now() - started, textLength: result.textLength, title: result.title };
  } finally {
    await client.send("Target.closeTarget", { targetId: target.targetId }).catch(() => undefined);
  }
}

async function attachTarget(client, url, waitForInitialLoad = true) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank", background: true });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await Promise.all([
    client.send("Page.enable", {}, sessionId),
    client.send("Runtime.enable", {}, sessionId)
  ]);
  if (url !== "about:blank") {
    const loaded = waitForInitialLoad ? client.waitFor("Page.loadEventFired", sessionId, 5_000) : Promise.resolve();
    await client.send("Page.navigate", { url }, sessionId);
    await loaded;
  }
  return { targetId, sessionId };
}

async function installExtractor(client, sessionId, bundle) {
  await evaluate(client, sessionId, `globalThis.chrome = { runtime: { onMessage: { addListener(listener) { globalThis.__groundtabExtractor = listener; } } } }; true;`);
  await evaluate(client, sessionId, bundle);
  const installed = await evaluate(client, sessionId, `typeof globalThis.__groundtabExtractor === "function"`);
  if (!installed) throw new Error("GroundTab extractor did not register in the benchmark target");
}

async function settleDom(client, sessionId) {
  let previous = await domSnapshot(client, sessionId);
  const deadline = performance.now() + 900;
  while (performance.now() + 150 < deadline) {
    await delay(150);
    const current = await domSnapshot(client, sessionId);
    if (stable(previous, current)) return;
    previous = current;
  }
}

function domSnapshot(client, sessionId) {
  return evaluate(client, sessionId, `({ readyState: document.readyState, textLength: document.body?.innerText.length ?? 0, elementCount: document.body?.getElementsByTagName("*").length ?? 0 })`);
}

function stable(previous, current) {
  if (current.readyState !== "complete") return false;
  const textDelta = Math.abs(current.textLength - previous.textLength);
  const elementDelta = Math.abs(current.elementCount - previous.elementCount);
  return textDelta <= Math.max(50, previous.textLength * 0.05) && elementDelta <= Math.max(5, previous.elementCount * 0.05);
}

async function evaluate(client, sessionId, expression) {
  const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Browser evaluation failed");
  }
  return response.result?.value;
}

function assertUsefulExtraction(result, expectedChars, path) {
  if (!result || result.title !== "GroundTab benchmark article" || !Number.isInteger(result.textLength) || result.textLength < 5_000) {
    throw new Error(`${path} extraction did not return the complete fixture: ${JSON.stringify(result)}`);
  }
  if (expectedChars !== null && result.textLength !== expectedChars) {
    throw new Error(`${path} extraction changed content length: expected ${expectedChars}, got ${result.textLength}`);
  }
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function milliseconds(value) {
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ms`;
}

function integerSetting(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Benchmark setting must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function listen(httpServer) {
  return new Promise((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolveListen(httpServer.address()));
  });
}

async function browserExecutable() {
  const explicit = process.env.GROUNDTAB_BENCH_BROWSER;
  const candidates = explicit ? [explicit] : platform() === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { continue; }
  }
  throw new Error("Chrome, Brave, or Chromium was not found. Set GROUNDTAB_BENCH_BROWSER to its executable path.");
}

async function launchBrowser(executable, userDataDir) {
  const child = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: "ignore" });
  const activePortPath = join(userDataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Browser exited before the benchmark started (${child.exitCode})`);
    try {
      const [port, path] = (await readFile(activePortPath, "utf8")).trim().split("\n");
      if (port && path) return { child, webSocketUrl: `ws://127.0.0.1:${port}${path}` };
    } catch { /* Browser is still starting. */ }
    await delay(50);
  }
  throw new Error("Browser DevTools endpoint did not become ready");
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    socket.addEventListener("message", (event) => this.onMessage(JSON.parse(event.data)));
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  waitFor(method, sessionId, timeoutMs) {
    return new Promise((resolveWait, reject) => {
      const waiter = { method, sessionId, resolve: resolveWait, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  onMessage(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result);
      return;
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== message.method || waiter.sessionId !== message.sessionId) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
      waiter.resolve(message.params);
    }
  }
}

await main();
