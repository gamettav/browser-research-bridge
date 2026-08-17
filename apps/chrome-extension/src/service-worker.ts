import {
  AuthChallengeSchema,
  AuthOkSchema,
  BRIDGE_BUILD_ID,
  BrowserJobSchema,
  DEFAULT_PORT,
  HeartbeatAckSchema,
  JobMessageSchema,
  NavigationCheckResultSchema,
  PairingErrorSchema,
  PairingOkSchema,
  PairingRequiredSchema,
  PROTOCOL_VERSION,
  ProtocolErrorSchema,
  clientProofPayload,
  constantTimeHexEqual,
  hmacSha256Hex,
  isAllowedPublicWebUrl,
  isValidBridgeToken,
  isValidPairingCode,
  normalizePairingCode,
  pairingOkPayload,
  pairingProofHex,
  pairingSubmitPayload,
  safeDomain,
  serverProofPayload,
  type BrowserJob,
  type ResearchPhase
} from "@groundtab/protocol";
import { unwrapExtractionResult } from "./extraction-result.js";
import {
  canonicalFetchKey,
  classifyFastFetchResponse,
  DomainCompatibilityMemory,
  domSnapshotsAreStable,
  type DomSnapshot,
  type FastFetchFallbackReason
} from "./fast-fetch.js";
import { assertNavigationUrl, type DnsResolve } from "./navigation-policy.js";

type BridgeConfig = { token: string; port: number };
type BrowserError = { code: string; message: string };
type PhaseEmitter = (phase: ResearchPhase, domain: string | null) => void;
type BridgeTransport = {
  kind: "websocket";
  isOpen: () => boolean;
  send: (message: unknown) => void;
  close: () => void;
};
type StaticFetchPayload = { status: number; contentType: string | null; finalUrl: string; body: string };

let transport: BridgeTransport | null = null;
let activeConfig: BridgeConfig | null = null;
let heartbeat: number | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
const pendingNavigationChecks = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: number }>();
const inFlightStaticFetches = new Map<string, Promise<StaticFetchPayload>>();
const fastFetchCompatibility = new DomainCompatibilityMemory();
const RECONNECT_ALARM = "groundtab-reconnect";
const MAX_STATIC_BODY_BYTES = 5_000_000;
const STATIC_FETCH_TIMEOUT_MS = 12_000;
let creatingOffscreenDocument: Promise<void> | null = null;
let pendingPairing: { nonce: string; code: string | null } | null = null;

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
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("options.html")) return;
  if (message?.type === "connection_refresh") {
    void connect().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "pairing_submit") {
    void submitPairingCode(String(message.code ?? "")).then(sendResponse);
    return true;
  }
  if (message?.type === "pair_again") {
    void chrome.storage.local.remove(["token", "pairingState"]).then(() => {
      activeConfig = null;
      pendingPairing = null;
      reconnectAttempt = 0;
      transport?.close();
      void connect();
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.action.onClicked.addListener(() => {
  void connect();
  void chrome.runtime.openOptionsPage();
});

void connect();
scheduleReconnectAlarm();

async function connect(): Promise<void> {
  clearReconnect();
  if (transport?.isOpen()) return;
  activeConfig = await loadConfig();
  connectWebSocket(activeConfig?.port ?? DEFAULT_PORT);
}

function connectWebSocket(port: number): void {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const next: BridgeTransport = {
    kind: "websocket",
    isOpen: () => socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING,
    send: (message) => socket.send(JSON.stringify(message)),
    close: () => socket.close(1000, "transport closing")
  };
  transport = next;
  socket.addEventListener("open", () => {
    next.send({
      type: "extension_hello",
      extensionId: chrome.runtime.id,
      hasToken: activeConfig !== null,
      clientVersion: chrome.runtime.getManifest().version,
      clientBuildId: BRIDGE_BUILD_ID
    });
  });
  socket.addEventListener("message", (event) => {
    try { void onTransportMessage(next, JSON.parse(String(event.data))); } catch { return; }
  });
  socket.addEventListener("close", () => handleTransportClosed(next));
  socket.addEventListener("error", () => socket.close());
}

async function onTransportMessage(target: BridgeTransport, message: unknown): Promise<void> {
    const pairingRequired = PairingRequiredSchema.safeParse(message);
    if (pairingRequired.success) {
      if (pairingRequired.data.protocolVersion !== PROTOCOL_VERSION) {
        await setStatus(false, `Protocol mismatch: extension ${PROTOCOL_VERSION}, broker ${pairingRequired.data.protocolVersion}`);
        target.close();
        return;
      }
      pendingPairing = { nonce: pairingRequired.data.nonce, code: null };
      await chrome.storage.local.set({
        pairingState: { required: true, expiresAt: pairingRequired.data.expiresAt },
        connectionStatus: { connected: false, message: "Ready to pair with your agent", at: new Date().toISOString() }
      });
      await chrome.action.setBadgeText({ text: "PAIR" });
      return;
    }

    const pairingOk = PairingOkSchema.safeParse(message);
    if (pairingOk.success) {
      const pairing = pendingPairing;
      if (!pairing?.code || pairing.nonce !== pairingOk.data.nonce) {
        await setStatus(false, "The local broker returned an unexpected pairing response.");
        target.close();
        return;
      }
      const expectedProof = await pairingProofHex(
        pairing.code,
        pairingOkPayload(pairingOk.data.nonce, pairingOk.data.token, pairingOk.data.port, chrome.runtime.id, PROTOCOL_VERSION)
      );
      if (!constantTimeHexEqual(pairingOk.data.proof, expectedProof)) {
        await setStatus(false, "The local broker could not prove it knew the pairing code.");
        target.close();
        return;
      }
      activeConfig = { token: pairingOk.data.token, port: pairingOk.data.port };
      pendingPairing = null;
      await chrome.storage.local.set({
        token: pairingOk.data.token,
        port: pairingOk.data.port,
        pairingState: { required: false },
        configuredAutomatically: true
      });
      await setStatus(false, "Paired. Establishing the secure connection…");
      reconnectAttempt = 0;
      target.close();
      return;
    }

    const pairingError = PairingErrorSchema.safeParse(message);
    if (pairingError.success) {
      await setStatus(false, pairingError.data.message);
      return;
    }

    const challenge = AuthChallengeSchema.safeParse(message);
    if (challenge.success && challenge.data.channel === "extension") {
      const config = activeConfig;
      if (!config) {
        await setStatus(false, "Pair this extension with the GroundTab plugin first.");
        target.close();
        return;
      }
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
      void chrome.storage.local.set({ pairingState: { required: false } });
      void setStatus(true, "Connected securely to your agent");
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

function handleTransportClosed(target: BridgeTransport, detail?: string): void {
  if (transport !== target) return;
  transport = null;
  stopHeartbeat();
  rejectNavigationChecks(new Error("Broker disconnected during navigation validation"));
  void setStatus(false, activeConfig
    ? "Waiting for the GroundTab plugin in your agent."
    : "Install the GroundTab plugin in Codex or Claude Code, then pair once.");
  void chrome.action.setBadgeText({ text: activeConfig ? "OFF" : "SET" });
  scheduleReconnect();
}

async function submitPairingCode(value: string): Promise<{ ok: boolean; message: string }> {
  const code = normalizePairingCode(value);
  if (!isValidPairingCode(code)) return { ok: false, message: "Enter the 16-character pairing code shown by your agent." };
  if (!pendingPairing || !transport?.isOpen()) {
    return { ok: false, message: "The agent plugin is not reachable yet. Start Codex or Claude Code and try again." };
  }
  const proof = await pairingProofHex(code, pairingSubmitPayload(pendingPairing.nonce, chrome.runtime.id, PROTOCOL_VERSION));
  pendingPairing.code = code;
  transport.send({ type: "pairing_submit", nonce: pendingPairing.nonce, proof });
  await setStatus(false, "Checking pairing code…");
  return { ok: true, message: "Checking pairing code…" };
}

async function executeJob(input: BrowserJob, deadlineAt: number, emit: PhaseEmitter): Promise<unknown> {
  const job = BrowserJobSchema.parse(input);
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw browserError("job_expired", "Browser job deadline elapsed");
  const executionDeadlineAt = Math.min(deadlineAt, Date.now() + job.timeoutMs);
  if (job.kind === "fetch_rendered_page") return fetchRenderedPage(job, executionDeadlineAt, emit);
  return searchWeb(job, executionDeadlineAt, emit);
}

async function fetchRenderedPage(
  job: Extract<BrowserJob, { kind: "fetch_rendered_page" }>,
  deadlineAt: number,
  emit: PhaseEmitter
) {
  if (!isAllowedPublicWebUrl(job.url)) throw browserError("blocked_url", "URL is outside the public HTTP(S) policy");
  if (fastFetchCompatibility.shouldTryFast(job.url)) {
    emit("navigating", safeDomain(job.url));
    try {
      await withDeadline(assertPublicNavigation(job.url), deadlineAt);
      const fetched = await withDeadline(getStaticFetch(job.url, deadlineAt), deadlineAt);
      const classification = classifyFastFetchResponse({
        status: fetched.status,
        contentType: fetched.contentType,
        body: fetched.body
      });
      if (classification.kind === "static") {
        emit("extracting", safeDomain(fetched.finalUrl));
        const result = unwrapExtractionResult(await withDeadline(extractStaticPage(job, fetched), deadlineAt));
        if (isChallengeResult(result)) {
          fastFetchCompatibility.recordFallback(job.url, "challenge_page");
        } else {
          fastFetchCompatibility.recordSuccess(job.url);
          return result;
        }
      } else {
        rememberFastFetchFallback(job.url, classification.reason);
      }
    } catch (error) {
      if (isDeadlineOrPolicyError(error)) throw error;
      // Network, body-size, and parser failures are recoverable. The rendered
      // path below remains the source of truth for the wire result.
    }
  }

  return fetchPageInRenderedTab(job, deadlineAt, emit);
}

async function fetchPageInRenderedTab(
  job: Extract<BrowserJob, { kind: "fetch_rendered_page" }>,
  deadlineAt: number,
  emit: PhaseEmitter
) {
  return withInactiveTab(job.url, deadlineAt, "navigating", emit, async (tabId, finalUrl) => {
    await assertFinalNavigation(finalUrl, deadlineAt);
    assertDeadline(deadlineAt);
    const current = await chrome.tabs.get(tabId);
    if (!current.url || current.url !== finalUrl) throw browserError("navigation_changed", "Page URL changed after validation; refusing extraction");
    emit("extracting", safeDomain(finalUrl));
    await injectExtractor(tabId);
    assertDeadline(deadlineAt);
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

async function searchWeb(job: Extract<BrowserJob, { kind: "search_web" }>, deadlineAt: number, emit: PhaseEmitter) {
  const url = searchUrl(job.provider, job.query);
  return withInactiveTab(url, deadlineAt, "searching", emit, async (tabId, finalUrl) => {
    await assertFinalNavigation(finalUrl, deadlineAt);
    assertDeadline(deadlineAt);
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
  deadlineAt: number,
  openPhase: Extract<ResearchPhase, "navigating" | "searching">,
  emit: PhaseEmitter,
  action: (tabId: number, finalUrl: string) => Promise<T>
): Promise<T> {
  assertDeadline(deadlineAt);
  await withDeadline(assertPublicNavigation(url), deadlineAt);
  emit(openPhase, safeDomain(url));
  const tab = await withDeadline(chrome.tabs.create({ url, active: false }), deadlineAt);
  if (tab.id === undefined) throw browserError("tab_create_failed", "Chrome did not return a tab ID");
  try {
    const settledUrl = await waitForTab(tab.id, remainingMs(deadlineAt));
    emit("rendering", safeDomain(settledUrl));
    await waitForDomSettle(tab.id, deadlineAt);
    assertDeadline(deadlineAt);
    const current = await chrome.tabs.get(tab.id);
    if (!current.url) throw browserError("navigation_missing", "Navigation completed without a current URL");
    const finalUrl = current.url;
    return await withDeadline(action(tab.id, finalUrl), deadlineAt);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function assertPublicNavigation(value: string): Promise<void> {
  const dns = (chrome as unknown as { dns?: { resolve?: DnsResolve } }).dns;
  const resolveDns = typeof dns?.resolve === "function" ? dns.resolve.bind(dns) : undefined;
  await assertNavigationUrl(value, resolveDns);
}

async function assertFinalNavigation(value: string, deadlineAt: number): Promise<void> {
  if (!isAllowedPublicWebUrl(value)) throw browserError("blocked_redirect", "Page redirected to a blocked origin");
  await withDeadline(assertPublicNavigation(value), deadlineAt);
  assertDeadline(deadlineAt);
  if (!transport?.isOpen()) throw browserError("broker_disconnected", "Broker unavailable during final navigation validation");
  const id = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const timeoutMs = Math.min(5_000, remainingMs(deadlineAt));
    const timer = setTimeout(() => {
      pendingNavigationChecks.delete(id);
      reject(browserError("navigation_check_timeout", "Broker did not validate the final navigation in time"));
    }, timeoutMs) as unknown as number;
    pendingNavigationChecks.set(id, { resolve, reject, timer });
    transport!.send({ type: "navigation_check", id, url: value });
  });
}

function getStaticFetch(url: string, deadlineAt: number): Promise<StaticFetchPayload> {
  const key = canonicalFetchKey(url);
  const existing = inFlightStaticFetches.get(key);
  if (existing) return existing;
  const pending = performStaticFetch(key, deadlineAt).finally(() => {
    if (inFlightStaticFetches.get(key) === pending) inFlightStaticFetches.delete(key);
  });
  inFlightStaticFetches.set(key, pending);
  return pending;
}

async function performStaticFetch(url: string, deadlineAt: number): Promise<StaticFetchPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATIC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      signal: controller.signal
    });
    const finalUrl = response.url || url;
    // A redirect has already been followed by Chrome at this point (the same
    // limitation as tab navigation), but broker/DNS approval must happen
    // before the extension consumes any bytes from the final destination.
    await assertFinalNavigation(finalUrl, deadlineAt);
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const statusNeedsNoBody = response.status >= 400 || response.status === 204 || response.status === 205;
    const knownUnsupportedType = mediaType !== "" && mediaType !== "text/html" && mediaType !== "application/xhtml+xml";
    const body = statusNeedsNoBody || knownUnsupportedType ? "" : await readBoundedBody(response, MAX_STATIC_BODY_BYTES);
    return {
      status: response.status,
      contentType,
      finalUrl,
      body
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw browserError("static_body_too_large", `Static response exceeded the ${maxBytes}-byte fast-path limit`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw browserError("static_body_too_large", `Static response exceeded the ${maxBytes}-byte fast-path limit`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function extractStaticPage(
  job: Extract<BrowserJob, { kind: "fetch_rendered_page" }>,
  fetched: StaticFetchPayload
): Promise<unknown> {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({
    type: "extract_static_page",
    requestedUrl: job.url,
    finalUrl: fetched.finalUrl,
    html: fetched.body,
    maxChars: job.maxChars
  });
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreenDocument ??= chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: "Parse statically fetched public HTML without opening a browser tab"
  }).finally(() => { creatingOffscreenDocument = null; });
  await creatingOffscreenDocument;
}

async function waitForDomSettle(tabId: number, deadlineAt: number): Promise<void> {
  const settleUntil = Math.min(deadlineAt, Date.now() + 900);
  let previous = await sampleDom(tabId).catch(() => null);
  if (!previous) return;

  while (Date.now() + 150 < settleUntil) {
    await delay(150);
    const current = await sampleDom(tabId).catch(() => null);
    if (!current) return;
    if (domSnapshotsAreStable(previous, current)) return;
    previous = current;
  }
}

async function sampleDom(tabId: number): Promise<DomSnapshot> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      readyState: document.readyState,
      textLength: document.body?.innerText.length ?? 0,
      elementCount: document.body?.getElementsByTagName("*").length ?? 0
    })
  });
  const snapshot = results[0]?.result;
  if (!snapshot) throw browserError("dom_sample_failed", "Chrome returned no DOM settle sample");
  return snapshot;
}

function rememberFastFetchFallback(url: string, reason: FastFetchFallbackReason): void {
  fastFetchCompatibility.recordFallback(url, reason);
}

function isChallengeResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && "challenge" in value && value.challenge === true;
}

function isDeadlineOrPolicyError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") return false;
  return new Set(["job_expired", "blocked_url", "blocked_redirect", "blocked_dns", "dns_failed"]).has(error.code);
}

function remainingMs(deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw browserError("job_expired", "Browser job deadline elapsed");
  return remaining;
}

function assertDeadline(deadlineAt: number): void {
  remainingMs(deadlineAt);
}

function withDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  const timeoutMs = remainingMs(deadlineAt);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(browserError("job_expired", "Browser job deadline elapsed")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
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
