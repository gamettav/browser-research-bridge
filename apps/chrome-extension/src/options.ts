import { normalizePairingCode } from "@groundtab/protocol";

const form = requireElement<HTMLFormElement>("pairing-form");
const codeInput = requireElement<HTMLInputElement>("pairing-code");
const submitButton = requireElement<HTMLButtonElement>("pair-button");
const pairAgainButton = requireElement<HTMLButtonElement>("pair-again");
const status = requireElement<HTMLOutputElement>("status");
const pairingPanel = requireElement<HTMLElement>("pairing-panel");

void chrome.storage.local.get(["connectionStatus", "pairingState"]).then((stored) => {
  renderStatus(stored.connectionStatus);
  renderPairingState(stored.pairingState);
});

codeInput.addEventListener("input", () => {
  const normalized = normalizePairingCode(codeInput.value);
  if (codeInput.value !== normalized) codeInput.value = normalized;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  void chrome.runtime.sendMessage({ type: "pairing_submit", code: codeInput.value }).then((response: unknown) => {
    const result = response as { ok?: boolean; message?: string } | undefined;
    status.textContent = result?.message ?? "Could not reach the extension service worker.";
    if (!result?.ok) submitButton.disabled = false;
  }).catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
    submitButton.disabled = false;
  });
});

pairAgainButton.addEventListener("click", () => {
  pairAgainButton.disabled = true;
  void chrome.runtime.sendMessage({ type: "pair_again" }).then(() => {
    pairingPanel.hidden = false;
    codeInput.value = "";
    submitButton.disabled = false;
    status.textContent = "Waiting for the agent plugin…";
  }).finally(() => { pairAgainButton.disabled = false; });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.connectionStatus) {
    renderStatus(changes.connectionStatus.newValue);
    submitButton.disabled = false;
  }
  if (changes.pairingState) renderPairingState(changes.pairingState.newValue);
});

function renderStatus(value: unknown): void {
  if (!value || typeof value !== "object") {
    status.textContent = "Waiting for the GroundTab plugin in your agent…";
    status.dataset.connected = "false";
    return;
  }
  const record = value as Record<string, unknown>;
  status.textContent = typeof record.message === "string" ? record.message : record.connected ? "Connected" : "Not connected";
  status.dataset.connected = String(record.connected === true);
}

function renderPairingState(value: unknown): void {
  const paired = typeof value === "object" && value !== null && (value as Record<string, unknown>).required === false;
  pairingPanel.hidden = paired;
  pairAgainButton.hidden = !paired;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
