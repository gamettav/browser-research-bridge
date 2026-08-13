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
  ResearchErrorCodeSchema,
  clientProofPayload,
  constantTimeHexEqual,
  errorCodeForChallenge,
  hmacSha256Hex,
  isAllowedPublicWebUrl,
  isValidBridgeToken,
  safeDomain,
  serverProofPayload,
  terminalPhaseForError,
  type BrowserJob,
  type ResearchErrorCode,
  type ResearchPhase
} from "@browser-research/protocol";
import { unwrapExtractionResult } from "./extraction-result.js";
import { assertNavigationUrl, type DnsResolve } from "./navigation-policy.js";
import { ActivityStateController, type ActivityKind, type ActivityUiState } from "./activity-state.js";
import { CONNECTION_STATUS_KEY, type ConnectionStatus } from "./popup-model.js";
import { applyToolbarPresentation, createToolbarIcon, toolbarPresentation } from "./toolbar.js";

type BridgeConfig = { token: string; port: number };
type BrowserError = { code: ResearchErrorCode; message: string };
type PhaseEmitter = (phase: ResearchPhase, domain: string | null, errorCode?: ResearchErrorCode) => void;
type BridgeTransport = {
  kind: "native" | "websocket";
  isOpen: () => boolean;
  send: (message: unknown) => void;
  close: () => void;
};

let transport: BridgeTransport | null = null;
let transportAuthenticated = false;
let heartbeat: number | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let brokerVersion: string | null = null;
let brokerBuildId: string | null = null;
let lastHeartbeatAt: number | null = null;
const pendingNavigationChecks = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: number }>();
const RECONNECT_ALARM = "browser-research-reconnect";
const NATIVE_HOST_NAME = "com.browser_research.bridge";
const activityState = new ActivityStateController(
  { session: chrome.storage.session, local: chrome.storage.local },
  updateToolbar
);

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "config_updated" && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("options.html")) {
    reconnectAttempt = 0;
    transport?.close();
    void connect();
    return false;
  }
  if (message?.type === "popup_run_diagnostics" && sender.url === chrome.runtime.getURL("popup.html")) {
    void runDiagnostics().then(sendResponse, (error: unknown) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  return false;
});

void activityState.restore();
void connect();
scheduleReconnectAlarm();

async function connect(): Promise<void> {
  clearReconnect();
  if (transport?.isOpen()) return;
  const config = await loadConfig();
  if (!config) {
    await setStatus(false, "Open settings to configure the bridge token.", { configured: false, attention: "error" });
    return;
  }

  await setStatus(false, "Connecting to the local broker…", { configured: true, attention: "none" });
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
      brokerVersion = challenge.data.serverVersion;
      brokerBuildId = challenge.data.serverBuildId;
      if (challenge.data.protocolVersion !== PROTOCOL_VERSION) {
        await setStatus(false, `Protocol mismatch: extension ${PROTOCOL_VERSION}, broker ${challenge.data.protocolVersion}`, {
          configured: true,
          attention: "error",
          transport: target.kind
        });
        target.close();
        return;
      }
      const expectedProof = await hmacSha256Hex(config.token, serverProofPayload(
        "extension", challenge.data.nonce, challenge.data.protocolVersion, challenge.data.serverBuildId
      ));
      if (!constantTimeHexEqual(challenge.data.proof, expectedProof)) {
        await setStatus(false, "Local broker failed to prove possession of the configured token.", {
          configured: true,
          attention: "error",
          transport: target.kind
        });
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
      transportAuthenticated = true;
      brokerVersion = auth.data.serverVersion;
      brokerBuildId = auth.data.serverBuildId;
      lastHeartbeatAt = Date.now();
      startHeartbeat(target);
      void setStatus(true, `Connected via ${target.kind === "native" ? "Native Messaging" : "loopback WebSocket"}`, {
        configured: true,
        attention: "ready",
        transport: target.kind
      });
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

    if (HeartbeatAckSchema.safeParse(message).success) {
      lastHeartbeatAt = Date.now();
      void setStatus(true, `Connected via ${target.kind === "native" ? "Native Messaging" : "loopback WebSocket"}`, {
        configured: true,
        attention: "ready",
        transport: target.kind
      });
      return;
    }

    const protocolError = ProtocolErrorSchema.safeParse(message);
    if (protocolError.success) {
      await setStatus(false, `Protocol error (${protocolError.data.code}): ${protocolError.data.message}`, {
        configured: true,
        attention: "error",
        transport: target.kind
      });
      return;
    }

    const parsed = JobMessageSchema.safeParse(message);
    if (!parsed.success) {
      if (target.isOpen()) target.send({ type: "protocol_error", code: "invalid_broker_message", message: "Broker sent a schema-invalid message" });
      return;
    }
    const activityKind: ActivityKind = parsed.data.job.kind === "search_web" ? "search" : "read";
    let activityDomain = initialJobDomain(parsed.data.job);
    const trackActivity = (phase: ResearchPhase, domain: string | null, errorCode?: ResearchErrorCode): void => {
      void activityState.record({
        id: parsed.data.id,
        kind: activityKind,
        domain,
        phase,
        queuedAt: parsed.data.queuedAt,
        elapsedMs: Math.max(0, Date.now() - parsed.data.queuedAt),
        ...(parsed.data.source ? { source: parsed.data.source } : {}),
        ...(errorCode ? { errorCode } : {})
      });
    };
    const emit: PhaseEmitter = (phase, domain, errorCode) => {
      activityDomain = domain ?? activityDomain;
      trackActivity(phase, activityDomain, errorCode);
      if (target.isOpen()) {
        target.send({
          type: "job_progress",
          id: parsed.data.id,
          sessionId: parsed.data.sessionId,
          source: parsed.data.source,
          phase,
          domain: activityDomain,
          elapsedMs: Math.max(0, Date.now() - parsed.data.queuedAt),
          errorCode
        });
      }
    };
    trackActivity("queued", activityDomain);
    void (async () => {
      try {
        if (Date.now() >= parsed.data.deadlineAt) throw browserError("job_expired", "Browser job expired before execution began");
        const result = await executeJob(parsed.data.job, parsed.data.deadlineAt, emit);
        const challenge = challengeError(result);
        if (challenge) throw challenge;
        const durationMs = Math.max(0, Date.now() - parsed.data.queuedAt);
        emit("completed", activityDomain);
        await activityState.flush();
        if (target.isOpen()) target.send({
          type: "job_result",
          id: parsed.data.id,
          sessionId: parsed.data.sessionId,
          durationMs,
          ok: true,
          result
        });
      } catch (error: unknown) {
        const normalized = toBrowserError(error);
        const durationMs = Math.max(0, Date.now() - parsed.data.queuedAt);
        emit(terminalPhaseForError(normalized.code), activityDomain, normalized.code);
        await activityState.flush();
        if (target.isOpen()) target.send({
          type: "job_result" as const,
          id: parsed.data.id,
          sessionId: parsed.data.sessionId,
          durationMs,
          ok: false as const,
          error: normalized
        });
      }
    })();
}

function handleTransportClosed(target: BridgeTransport, config: BridgeConfig, detail?: string): void {
  if (transport !== target) return;
  transport = null;
  transportAuthenticated = false;
  stopHeartbeat();
  rejectNavigationChecks(new Error("Broker disconnected during navigation validation"));
  if (target.kind === "native") {
    void setStatus(false, `Native host unavailable${detail ? `: ${detail}` : ""}; trying loopback fallback.`, {
      configured: true,
      attention: "none",
      transport: "native"
    });
    connectWebSocket(config);
    return;
  }
  void setStatus(false, "Local broker is unavailable or rejected the connection.", {
    configured: true,
    attention: "error",
    transport: "websocket"
  });
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
    const current = await getTab(tabId);
    if (!current.url || current.url !== finalUrl) throw browserError("navigation_changed", "Page URL changed after validation; refusing extraction");
    emit("extracting", safeDomain(finalUrl));
    await injectExtractor(tabId);
    const immediatelyBeforeExtraction = await getTab(tabId);
    if (!immediatelyBeforeExtraction.url || immediatelyBeforeExtraction.url !== finalUrl) {
      throw browserError("navigation_changed", "Page URL changed during extractor setup; refusing extraction");
    }
    const result: unknown = await chrome.tabs.sendMessage(tabId, {
      type: "extract_page",
      requestedUrl: job.url,
      maxChars: job.maxChars
    }).catch((error: unknown) => {
      throw browserError("extraction_failed", error instanceof Error ? error.message : String(error));
    });
    return unwrapExtractionResult(result);
  });
}

async function searchWeb(job: Extract<BrowserJob, { kind: "search_web" }>, emit: PhaseEmitter) {
  const url = searchUrl(job.provider, job.query);
  return withInactiveTab(url, job.timeoutMs, "searching", emit, async (tabId, finalUrl) => {
    await assertFinalNavigation(finalUrl);
    const current = await getTab(tabId);
    if (!current.url || current.url !== finalUrl) throw browserError("navigation_changed", "Search URL changed after validation");
    emit("extracting", safeDomain(finalUrl));
    await injectExtractor(tabId);
    const immediatelyBeforeExtraction = await getTab(tabId);
    if (!immediatelyBeforeExtraction.url || immediatelyBeforeExtraction.url !== finalUrl) {
      throw browserError("navigation_changed", "Search URL changed during extractor setup");
    }
    const result: unknown = await chrome.tabs.sendMessage(tabId, {
      type: "extract_search",
      query: job.query,
      provider: job.provider,
      limit: job.limit,
      finalUrl
    }).catch((error: unknown) => {
      throw browserError("extraction_failed", error instanceof Error ? error.message : String(error));
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
  const tab = await chrome.tabs.create({ url, active: false }).catch((error: unknown) => {
    throw browserError("tab_failed", error instanceof Error ? error.message : String(error));
  });
  if (tab.id === undefined) throw browserError("tab_failed", "Chrome did not return a tab ID");
  try {
    const settledUrl = await waitForTab(tab.id, timeoutMs);
    emit("rendering", safeDomain(settledUrl));
    await delay(1_200);
    const current = await getTab(tab.id);
    if (!current.url) throw browserError("tab_failed", "Navigation completed without a current URL");
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
    const timer = setTimeout(() => finish(browserError("timeout", `Navigation timed out after ${timeoutMs}ms`)), timeoutMs);
    const listener: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (updatedId, change, tab) => {
      if (updatedId !== tabId || change.status !== "complete") return;
      const url = tab.url;
      if (!url) return;
      finish(undefined, url);
    };
    const removed = (removedId: number) => {
      if (removedId === tabId) finish(browserError("tab_failed", "Research tab was closed before extraction"));
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removed);
    void chrome.tabs.get(tabId).then((current) => {
      if (current.status === "complete" && current.url) finish(undefined, current.url);
    }).catch((error: unknown) => finish(browserError("tab_failed", error instanceof Error ? error.message : String(error))));

    function finish(error?: Error, url?: string) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removed);
      if (error) reject(error);
      else if (url) resolve(url);
      else reject(browserError("tab_failed", "Navigation completed without a URL"));
    }
  });
}

async function injectExtractor(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extractor.js"] }).catch((error: unknown) => {
    throw browserError("extraction_failed", error instanceof Error ? error.message : String(error));
  });
}

async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return chrome.tabs.get(tabId).catch((error: unknown) => {
    throw browserError("tab_failed", error instanceof Error ? error.message : String(error));
  });
}

function searchUrl(provider: "duckduckgo" | "bing" | "google", query: string): string {
  const encoded = encodeURIComponent(query);
  if (provider === "google") return `https://www.google.com/search?q=${encoded}`;
  if (provider === "bing") return `https://www.bing.com/search?q=${encoded}`;
  return `https://duckduckgo.com/?q=${encoded}`;
}

function initialJobDomain(job: BrowserJob): string | null {
  if (job.kind === "fetch_rendered_page") return safeDomain(job.url);
  return safeDomain(searchUrl(job.provider, ""));
}

function challengeError(value: unknown): Error | null {
  if (!value || typeof value !== "object" || !("challenge" in value) || value.challenge !== true) return null;
  const rawKind = "challengeKind" in value ? value.challengeKind : null;
  const kind = rawKind === "captcha" || rawKind === "login" || rawKind === "denied" ? rawKind : null;
  return browserError(errorCodeForChallenge(kind), "The page presented a login, CAPTCHA, challenge, or access-denied screen");
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

async function setStatus(
  connected: boolean,
  message: string,
  options: {
    configured: boolean;
    attention: "none" | "ready" | "error";
    transport?: BridgeTransport["kind"];
  }
): Promise<void> {
  const connectionStatus: ConnectionStatus = {
    connected,
    configured: options.configured,
    message,
    at: Date.now(),
    transport: options.transport ?? null,
    brokerVersion,
    brokerBuildId,
    protocolVersion: PROTOCOL_VERSION,
    lastHeartbeatAt
  };
  await chrome.storage.local.set({ [CONNECTION_STATUS_KEY]: connectionStatus });
  if (options.attention === "error") await activityState.setConnectionError();
  else if (options.attention === "ready") await activityState.setConnectionReady();
}

async function runDiagnostics(): Promise<{ ok: true; configured: boolean; connected: boolean }> {
  const config = await loadConfig();
  if (!config) {
    await setStatus(false, "Open settings to configure the bridge token.", { configured: false, attention: "error" });
    return { ok: true, configured: false, connected: false };
  }
  if (transportAuthenticated && transport?.isOpen()) {
    await setStatus(true, `Connected via ${transport.kind === "native" ? "Native Messaging" : "loopback WebSocket"}`, {
      configured: true,
      attention: "ready",
      transport: transport.kind
    });
    return { ok: true, configured: true, connected: true };
  }
  if (!transport?.isOpen()) await connect();
  else {
    await setStatus(false, "Connection check in progress…", {
      configured: true,
      attention: "none",
      transport: transport.kind
    });
  }
  return { ok: true, configured: true, connected: false };
}

async function updateToolbar(state: ActivityUiState): Promise<void> {
  const presentation = toolbarPresentation(state);
  try {
    await applyToolbarPresentation(chrome.action, presentation, createToolbarIcon);
  } catch {
    await Promise.allSettled([
      chrome.action.setBadgeText({ text: presentation.badgeText }),
      chrome.action.setBadgeBackgroundColor({ color: presentation.badgeColor }),
      chrome.action.setTitle({ title: presentation.title })
    ]);
  }
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
    const rawCode = "code" in error && typeof error.code === "string" ? error.code : "browser_error";
    return { code: normalizeBrowserErrorCode(rawCode, error.message), message: error.message };
  }
  return { code: "bridge_error", message: String(error) };
}

function normalizeBrowserErrorCode(rawCode: string, message: string): ResearchErrorCode {
  const known = ResearchErrorCodeSchema.safeParse(rawCode);
  if (known.success) return known.data;
  switch (rawCode) {
    case "blocked_navigation": return "blocked_redirect";
    case "blocked_dns": return "blocked_url";
    case "broker_disconnected": return "not_connected";
    case "navigation_check_timeout": return "timeout";
    case "tab_create_failed":
    case "navigation_missing": return "tab_failed";
    case "dns_failed": return "bridge_error";
  }
  const lower = message.toLowerCase();
  if (lower.includes("timed out") || lower.includes("timeout")) return "timeout";
  if (lower.includes("tab") && lower.includes("closed")) return "tab_failed";
  return "bridge_error";
}
