import {
  AuthChallengeSchema,
  AuthOkSchema,
  BRIDGE_BUILD_ID,
  BrowserJobSchema,
  DEFAULT_PORT,
  HeartbeatAckSchema,
  JobMessageSchema,
  NavigationCheckResultSchema,
  PROTOCOL_VERSION,
  ProtocolErrorSchema,
  clientProofPayload,
  constantTimeHexEqual,
  hmacSha256Hex,
  isAllowedPublicWebUrl,
  isValidBridgeToken,
  safeDomain,
  serverProofPayload,
  type BrowserJob,
  type ResearchPhase
} from "@browser-research/protocol";
import { unwrapExtractionResult } from "./extraction-result.js";
import { assertNavigationUrl, type DnsResolve } from "./navigation-policy.js";

type BridgeConfig = { token: string; port: number };
type BrowserError = { code: string; message: string };
type PhaseEmitter = (phase: ResearchPhase, domain: string | null) => void;
type BridgeTransport = {
  kind: "native" | "websocket";
  isOpen: () => boolean;
  send: (message: unknown) => void;
  close: () => void;
};

let transport: BridgeTransport | null = null;
let heartbeat: number | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
const pendingNavigationChecks = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: number }>();
const RECONNECT_ALARM = "browser-research-reconnect";
const NATIVE_HOST_NAME = "com.browser_research.bridge";

chrome.runtime.onInstalled.addListener(() => {
  scheduleReconnectAlarm();
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleReconnectAlarm();
  void connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connect();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "config_updated" && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("options.html")) {
    reconnectAttempt = 0;
    transport?.close();
    void connect();
  }
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

void connect();
scheduleReconnectAlarm();

async function connect(): Promise<void> {
  clearReconnect();
  if (transport?.isOpen()) return;
  const config = await loadConfig();
  if (!config) {
    await setStatus(false, "Open extension options to configure the bridge token.");
    await chrome.action.setBadgeText({ text: "SET" });
    return;
  }

  connectNative(config);
}

function connectNative(config: BridgeConfig): void {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  let open = true;
  const next: BridgeTransport = {
    kind: "native",
    isOpen: () => open,
    send: (message) => port.postMessage(message),
    close: () => {
      if (!open) return;
      open = false;
      port.disconnect();
    }
  };
  transport = next;
  port.onMessage.addListener((message: unknown) => { void onTransportMessage(next, config, message); });
  port.onDisconnect.addListener(() => {
    open = false;
    handleTransportClosed(next, config, chrome.runtime.lastError?.message);
  });
}

function connectWebSocket(config: BridgeConfig): void {
  const socket = new WebSocket(`ws://127.0.0.1:${config.port}`);
  const next: BridgeTransport = {
    kind: "websocket",
    isOpen: () => socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING,
    send: (message) => socket.send(JSON.stringify(message)),
    close: () => socket.close(1000, "transport closing")
  };
  transport = next;
  socket.addEventListener("message", (event) => {
    try { void onTransportMessage(next, config, JSON.parse(String(event.data))); } catch { return; }
  });
  socket.addEventListener("close", () => handleTransportClosed(next, config));
  socket.addEventListener("error", () => socket.close());
}

async function onTransportMessage(target: BridgeTransport, config: BridgeConfig, message: unknown): Promise<void> {
    const challenge = AuthChallengeSchema.safeParse(message);
    if (challenge.success && challenge.data.channel === "extension") {
      if (challenge.data.protocolVersion !== PROTOCOL_VERSION) {
        await setStatus(false, `Protocol mismatch: extension ${PROTOCOL_VERSION}, broker ${challenge.data.protocolVersion}`);
        target.close();
        return;
      }
      const expectedProof = await hmacSha256Hex(config.token, serverProofPayload(
        "extension", challenge.data.nonce, challenge.data.protocolVersion, challenge.data.serverBuildId
      ));
      if (!constantTimeHexEqual(challenge.data.proof, expectedProof)) {
        await setStatus(false, "Local broker failed to prove possession of the configured token.");
        target.close();
        return;
      }
      const proof = await hmacSha256Hex(config.token, clientProofPayload(
        "extension", challenge.data.nonce, PROTOCOL_VERSION, chrome.runtime.id, BRIDGE_BUILD_ID
      ));
      target.send({
        type: "auth_response",
        channel: "extension",
        nonce: challenge.data.nonce,
        protocolVersion: PROTOCOL_VERSION,
        clientId: chrome.runtime.id,
        clientVersion: chrome.runtime.getManifest().version,
        clientBuildId: BRIDGE_BUILD_ID,
        proof
      });
      return;
    }

    const auth = AuthOkSchema.safeParse(message);
    if (auth.success && auth.data.channel === "extension") {
      reconnectAttempt = 0;
      startHeartbeat(target);
      void setStatus(true, `Connected via ${target.kind === "native" ? "Native Messaging" : "loopback WebSocket"}`);
      void chrome.action.setBadgeText({ text: "" });
      return;
    }

    const navigation = NavigationCheckResultSchema.safeParse(message);
    if (navigation.success) {
      const pending = pendingNavigationChecks.get(navigation.data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingNavigationChecks.delete(navigation.data.id);
      if (navigation.data.ok) pending.resolve();
      else pending.reject(browserError(navigation.data.error.code, navigation.data.error.message));
      return;
    }

    if (HeartbeatAckSchema.safeParse(message).success) return;

    const protocolError = ProtocolErrorSchema.safeParse(message);
    if (protocolError.success) {
      await setStatus(false, `Protocol error (${protocolError.data.code}): ${protocolError.data.message}`);
      return;
    }

    const parsed = JobMessageSchema.safeParse(message);
    if (!parsed.success) {
      if (target.isOpen()) target.send({ type: "protocol_error", code: "invalid_broker_message", message: "Broker sent a schema-invalid message" });
      return;
    }
    const startedAt = Date.now();
    const emit: PhaseEmitter = (phase, domain) => {
      if (target.isOpen()) {
        target.send({ type: "job_progress", id: parsed.data.id, phase, domain: domain ?? null, elapsedMs: Date.now() - startedAt });
      }
    };
    void (async () => {
      if (Date.now() >= parsed.data.deadlineAt) throw browserError("job_expired", "Browser job expired before execution began");
      const response = await executeJob(parsed.data.job, parsed.data.deadlineAt, emit)
        .then((result) => ({ type: "job_result" as const, id: parsed.data.id, ok: true as const, result }))
        .catch((error: unknown) => ({
          type: "job_result" as const,
          id: parsed.data.id,
          ok: false as const,
          error: toBrowserError(error)
        }));
      if (target.isOpen()) target.send(response);
    })().catch((error: unknown) => {
      if (target.isOpen()) target.send({
        type: "job_result",
        id: parsed.data.id,
        ok: false,
        error: toBrowserError(error)
      });
    });
}

function handleTransportClosed(target: BridgeTransport, config: BridgeConfig, detail?: string): void {
  if (transport !== target) return;
  transport = null;
  stopHeartbeat();
  rejectNavigationChecks(new Error("Broker disconnected during navigation validation"));
  if (target.kind === "native") {
    void setStatus(false, `Native host unavailable${detail ? `: ${detail}` : ""}; trying loopback fallback.`);
    connectWebSocket(config);
    return;
  }
  void setStatus(false, "Local broker is unavailable or rejected the connection.");
  void chrome.action.setBadgeText({ text: "OFF" });
  scheduleReconnect();
}

async function executeJob(input: BrowserJob, deadlineAt: number, emit: PhaseEmitter): Promise<unknown> {
  const job = BrowserJobSchema.parse(input);
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw browserError("job_expired", "Browser job deadline elapsed");
  const boundedJob = { ...job, timeoutMs: Math.min(job.timeoutMs, remainingMs) };
  if (boundedJob.kind === "fetch_rendered_page") return fetchRenderedPage(boundedJob, emit);
  return searchWeb(boundedJob, emit);
}

async function fetchRenderedPage(job: Extract<BrowserJob, { kind: "fetch_rendered_page" }>, emit: PhaseEmitter) {
  if (!isAllowedPublicWebUrl(job.url)) throw browserError("blocked_url", "URL is outside the public HTTP(S) policy");
  return withInactiveTab(job.url, job.timeoutMs, "navigating", emit, async (tabId, finalUrl) => {
    await assertFinalNavigation(finalUrl);
    const current = await chrome.tabs.get(tabId);
    if (!current.url || current.url !== finalUrl) throw browserError("navigation_changed", "Page URL changed after validation; refusing extraction");
    emit("extracting", safeDomain(finalUrl));
    await injectExtractor(tabId);
    const immediatelyBeforeExtraction = await chrome.tabs.get(tabId);
    if (!immediatelyBeforeExtraction.url || immediatelyBeforeExtraction.url !== finalUrl) {
      throw browserError("navigation_changed", "Page URL changed during extractor setup; refusing extraction");
    }
    const result: unknown = await chrome.tabs.sendMessage(tabId, {
      type: "extract_page",
      requestedUrl: job.url,
      maxChars: job.maxChars
    });
    return unwrapExtractionResult(result);
  });
}

async function searchWeb(job: Extract<BrowserJob, { kind: "search_web" }>, emit: PhaseEmitter) {
  const url = searchUrl(job.provider, job.query);
  return withInactiveTab(url, job.timeoutMs, "searching", emit, async (tabId, finalUrl) => {
    await assertFinalNavigation(finalUrl);
    const current = await chrome.tabs.get(tabId);
    if (!current.url || current.url !== finalUrl) throw browserError("navigation_changed", "Search URL changed after validation");
    emit("extracting", safeDomain(finalUrl));
    await injectExtractor(tabId);
    const immediatelyBeforeExtraction = await chrome.tabs.get(tabId);
    if (!immediatelyBeforeExtraction.url || immediatelyBeforeExtraction.url !== finalUrl) {
      throw browserError("navigation_changed", "Search URL changed during extractor setup");
    }
    const result: unknown = await chrome.tabs.sendMessage(tabId, {
      type: "extract_search",
      query: job.query,
      provider: job.provider,
      limit: job.limit,
      finalUrl
    });
    return unwrapExtractionResult(result);
  });
}

async function withInactiveTab<T>(
  url: string,
  timeoutMs: number,
  openPhase: Extract<ResearchPhase, "navigating" | "searching">,
  emit: PhaseEmitter,
  action: (tabId: number, finalUrl: string) => Promise<T>
): Promise<T> {
  await assertPublicNavigation(url);
  emit(openPhase, safeDomain(url));
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) throw browserError("tab_create_failed", "Chrome did not return a tab ID");
  try {
    const settledUrl = await waitForTab(tab.id, timeoutMs);
    emit("rendering", safeDomain(settledUrl));
    await delay(1_200);
    const current = await chrome.tabs.get(tab.id);
    if (!current.url) throw browserError("navigation_missing", "Navigation completed without a current URL");
    const finalUrl = current.url;
    return await action(tab.id, finalUrl);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function assertPublicNavigation(value: string): Promise<void> {
  const dns = (chrome as unknown as { dns?: { resolve?: DnsResolve } }).dns;
  const resolveDns = typeof dns?.resolve === "function" ? dns.resolve.bind(dns) : undefined;
  await assertNavigationUrl(value, resolveDns);
}

async function assertFinalNavigation(value: string): Promise<void> {
  if (!isAllowedPublicWebUrl(value)) throw browserError("blocked_redirect", "Page redirected to a blocked origin");
  await assertPublicNavigation(value);
  if (!transport?.isOpen()) throw browserError("broker_disconnected", "Broker unavailable during final navigation validation");
  const id = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingNavigationChecks.delete(id);
      reject(browserError("navigation_check_timeout", "Broker did not validate the final navigation in time"));
    }, 5_000) as unknown as number;
    pendingNavigationChecks.set(id, { resolve, reject, timer });
    transport!.send({ type: "navigation_check", id, url: value });
  });
}

async function waitForTab(tabId: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Navigation timed out after ${timeoutMs}ms`)), timeoutMs);
    const listener: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (updatedId, change, tab) => {
      if (updatedId !== tabId || change.status !== "complete") return;
      const url = tab.url;
      if (!url) return;
      finish(undefined, url);
    };
    const removed = (removedId: number) => {
      if (removedId === tabId) finish(new Error("Research tab was closed before extraction"));
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removed);
    void chrome.tabs.get(tabId).then((current) => {
      if (current.status === "complete" && current.url) finish(undefined, current.url);
    }).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));

    function finish(error?: Error, url?: string) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removed);
      if (error) reject(error);
      else if (url) resolve(url);
      else reject(new Error("Navigation completed without a URL"));
    }
  });
}

async function injectExtractor(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extractor.js"] });
}

function searchUrl(provider: "duckduckgo" | "bing" | "google", query: string): string {
  const encoded = encodeURIComponent(query);
  if (provider === "google") return `https://www.google.com/search?q=${encoded}`;
  if (provider === "bing") return `https://www.bing.com/search?q=${encoded}`;
  return `https://duckduckgo.com/?q=${encoded}`;
}

async function loadConfig(): Promise<BridgeConfig | null> {
  const stored = await chrome.storage.local.get(["token", "port"]);
  if (!isValidBridgeToken(stored.token)) return null;
  const port = typeof stored.port === "number" ? stored.port : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { token: stored.token, port };
}

function startHeartbeat(target: BridgeTransport): void {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    if (target.isOpen()) target.send({ type: "heartbeat", at: Date.now() });
  }, 20_000) as unknown as number;
}

function stopHeartbeat(): void {
  if (heartbeat !== null) clearInterval(heartbeat);
  heartbeat = null;
}

function scheduleReconnect(): void {
  clearReconnect();
  const delayMs = Math.min(30_000, 1_000 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 500);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => void connect(), delayMs) as unknown as number;
}

function scheduleReconnectAlarm(): void {
  void chrome.alarms.get(RECONNECT_ALARM).then((existing) => {
    if (!existing) chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  });
}

function clearReconnect(): void {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

async function setStatus(connected: boolean, message: string): Promise<void> {
  await chrome.storage.local.set({ connectionStatus: { connected, message, at: new Date().toISOString() } });
}

function rejectNavigationChecks(error: Error): void {
  for (const [id, pending] of pendingNavigationChecks) {
    clearTimeout(pending.timer);
    pending.reject(error);
    pendingNavigationChecks.delete(id);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function toBrowserError(error: unknown): BrowserError {
  if (error instanceof Error) {
    return { code: "code" in error && typeof error.code === "string" ? error.code : "browser_error", message: error.message };
  }
  return { code: "browser_error", message: String(error) };
}

