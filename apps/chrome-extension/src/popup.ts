import {
  ACTIVITY_HISTORY_KEY,
  ACTIVITY_SESSION_KEY,
  readActivityHistory,
  readActivityUiState
} from "./activity-state.js";
import { buildPopupModel, CONNECTION_STATUS_KEY, type PopupModel } from "./popup-model.js";

const status = requireElement<HTMLElement>("toolbar-status");
const statusSymbol = requireElement<HTMLElement>("toolbar-status-symbol");
const statusText = requireElement<HTMLElement>("toolbar-status-text");
const currentSection = requireElement<HTMLElement>("current-activity");
const currentDomain = requireElement<HTMLElement>("current-domain");
const currentStage = requireElement<HTMLElement>("current-stage");
const currentElapsed = requireElement<HTMLElement>("current-elapsed");
const currentQueue = requireElement<HTMLElement>("current-queue");
const recentList = requireElement<HTMLUListElement>("recent-list");
const recentEmpty = requireElement<HTMLElement>("recent-empty");
const clearButton = requireElement<HTMLButtonElement>("clear-activity");
const connectionBadge = requireElement<HTMLElement>("connection-badge");
const connectionMessage = requireElement<HTMLElement>("connection-message");
const connectionTransport = requireElement<HTMLElement>("connection-transport");
const connectionHeartbeat = requireElement<HTMLElement>("connection-heartbeat");
const diagnosticsButton = requireElement<HTMLButtonElement>("run-diagnostics");
const settingsButton = requireElement<HTMLButtonElement>("open-settings");
const extensionVersion = requireElement<HTMLElement>("extension-version");
const brokerVersion = requireElement<HTMLElement>("broker-version");
const brokerBuild = requireElement<HTMLElement>("broker-build");
const protocolVersion = requireElement<HTMLElement>("protocol-version");

let renderPending: Promise<void> = Promise.resolve();

void render();
const elapsedTimer = window.setInterval(() => { void render(); }, 1_000);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    (areaName === "session" && changes[ACTIVITY_SESSION_KEY]) ||
    (areaName === "local" && (changes[ACTIVITY_HISTORY_KEY] || changes[CONNECTION_STATUS_KEY]))
  ) void render();
});

clearButton.addEventListener("click", () => {
  void chrome.storage.local.set({ [ACTIVITY_HISTORY_KEY]: [] }).then(() => render());
});

diagnosticsButton.addEventListener("click", () => {
  diagnosticsButton.disabled = true;
  diagnosticsButton.textContent = "Checking…";
  void chrome.runtime.sendMessage({ type: "popup_run_diagnostics" })
    .catch(() => undefined)
    .then(() => render())
    .finally(() => {
      diagnosticsButton.disabled = false;
      diagnosticsButton.textContent = "Check again";
    });
});

settingsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

window.addEventListener("unload", () => window.clearInterval(elapsedTimer), { once: true });

function render(): Promise<void> {
  renderPending = renderPending.then(async () => {
    const [activity, history, storedConnection] = await Promise.all([
      readActivityUiState(chrome.storage.session),
      readActivityHistory(chrome.storage.local),
      chrome.storage.local.get(CONNECTION_STATUS_KEY)
    ]);
    applyModel(buildPopupModel(
      activity,
      history,
      storedConnection[CONNECTION_STATUS_KEY],
      chrome.runtime.getManifest().version
    ));
  }, () => undefined);
  return renderPending;
}

function applyModel(model: PopupModel): void {
  status.dataset.mode = model.statusMode;
  statusSymbol.textContent = model.statusSymbol;
  statusText.textContent = model.statusText;

  currentSection.dataset.active = String(model.current.active);
  currentDomain.textContent = model.current.domain;
  currentStage.textContent = model.current.stage;
  currentElapsed.textContent = model.current.elapsed;
  currentQueue.textContent = model.current.queue;

  recentList.replaceChildren(...model.recent.map((entry) => {
    const item = document.createElement("li");
    item.className = "recent-item";
    item.dataset.tone = entry.tone;

    const outcome = document.createElement("span");
    outcome.className = "recent-symbol";
    outcome.textContent = entry.symbol;
    outcome.setAttribute("aria-label", entry.outcome);

    const body = document.createElement("span");
    body.className = "recent-body";
    const domain = document.createElement("strong");
    domain.textContent = entry.domain;
    const metadata = document.createElement("span");
    metadata.textContent = `${entry.outcome} · ${entry.duration} · ${entry.when}`;
    body.append(domain, metadata);
    item.append(outcome, body);
    return item;
  }));
  recentEmpty.hidden = model.recent.length > 0;
  clearButton.disabled = model.recent.length === 0;

  connectionBadge.dataset.connected = String(model.connection.connected);
  connectionBadge.textContent = `${model.connection.symbol} ${model.connection.label}`;
  connectionMessage.textContent = model.connection.message;
  connectionTransport.textContent = model.connection.transport;
  connectionHeartbeat.textContent = model.connection.heartbeat;

  extensionVersion.textContent = `v${model.extensionVersion}`;
  brokerVersion.textContent = model.brokerVersion === "Unavailable" ? "Unavailable" : `v${model.brokerVersion}`;
  brokerBuild.textContent = model.brokerBuildId;
  protocolVersion.textContent = `v${model.protocolVersion}`;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
