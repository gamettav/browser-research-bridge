import type { ActivityHistoryEntry, ActivityUiState, CurrentActivity } from "./activity-state.js";
import { toolbarPresentation, type ToolbarMode } from "./toolbar.js";

export const CONNECTION_STATUS_KEY = "connectionStatus";

export type ConnectionStatus = {
  connected: boolean;
  configured: boolean;
  message: string;
  at: number;
  transport: "native" | "websocket" | null;
  brokerVersion: string | null;
  brokerBuildId: string | null;
  protocolVersion: number;
  lastHeartbeatAt: number | null;
};

export type PopupCurrentModel = {
  active: boolean;
  domain: string;
  stage: string;
  elapsed: string;
  queue: string;
};

export type PopupRecentModel = {
  domain: string;
  when: string;
  duration: string;
  outcome: string;
  symbol: string;
  tone: "success" | "error" | "challenge";
};

export type PopupModel = {
  statusMode: ToolbarMode;
  statusSymbol: string;
  statusText: string;
  current: PopupCurrentModel;
  recent: PopupRecentModel[];
  connection: {
    connected: boolean;
    symbol: string;
    label: string;
    message: string;
    transport: string;
    heartbeat: string;
  };
  extensionVersion: string;
  brokerVersion: string;
  brokerBuildId: string;
  protocolVersion: string;
};

export function buildPopupModel(
  activity: ActivityUiState,
  history: ActivityHistoryEntry[],
  connectionValue: unknown,
  extensionVersion: string,
  now = Date.now()
): PopupModel {
  const presentation = toolbarPresentation(activity);
  const connection = sanitizeConnectionStatus(connectionValue);
  return {
    statusMode: presentation.mode,
    statusSymbol: symbolForMode(presentation.mode),
    statusText: labelForMode(presentation.mode, activity.activities.length),
    current: currentModel(activity.activities[0], now),
    recent: history.map((entry) => recentModel(entry, now)),
    connection: {
      connected: connection.connected,
      symbol: connection.connected ? "✓" : connection.configured ? "!" : "○",
      label: connection.connected ? "Connected" : connection.configured ? "Disconnected" : "Not configured",
      message: connection.message,
      transport: connection.transport === "native"
        ? "Native Messaging"
        : connection.transport === "websocket"
          ? "Loopback WebSocket"
          : "None",
      heartbeat: connection.lastHeartbeatAt ? relativeTime(connection.lastHeartbeatAt, now) : "Never"
    },
    extensionVersion,
    brokerVersion: connection.brokerVersion ?? "Unavailable",
    brokerBuildId: connection.brokerBuildId ?? "Unavailable",
    protocolVersion: String(connection.protocolVersion)
  };
}

export function sanitizeConnectionStatus(value: unknown): ConnectionStatus {
  if (!value || typeof value !== "object") return emptyConnectionStatus();
  const record = value as Record<string, unknown>;
  return {
    connected: record.connected === true,
    configured: record.configured === true,
    message: cleanText(record.message, record.configured === true ? "Connection unavailable" : "Open settings to connect"),
    at: finiteTimestamp(record.at),
    transport: record.transport === "native" || record.transport === "websocket" ? record.transport : null,
    brokerVersion: optionalText(record.brokerVersion),
    brokerBuildId: optionalText(record.brokerBuildId),
    protocolVersion: typeof record.protocolVersion === "number" && Number.isInteger(record.protocolVersion) && record.protocolVersion >= 0
      ? record.protocolVersion
      : 0,
    lastHeartbeatAt: typeof record.lastHeartbeatAt === "number" && Number.isFinite(record.lastHeartbeatAt) && record.lastHeartbeatAt > 0
      ? record.lastHeartbeatAt
      : null
  };
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function currentModel(activity: CurrentActivity | undefined, now: number): PopupCurrentModel {
  if (!activity) {
    return { active: false, domain: "No active page", stage: "Ready", elapsed: "—", queue: "—" };
  }
  return {
    active: true,
    domain: activity.domain ?? "Domain unavailable",
    stage: stageLabel(activity),
    elapsed: formatDuration(Math.max(0, now - activity.queuedAt)),
    queue: activity.source ? `${activity.source.index} of ${activity.source.total}` : "Active"
  };
}

function stageLabel(activity: CurrentActivity): string {
  switch (activity.phase) {
    case "queued": return activity.kind === "search" ? "Search queued" : "Read queued";
    case "searching": return "Searching";
    case "navigating": return "Opening page";
    case "rendering": return activity.kind === "search" ? "Rendering results" : "Rendering page";
    case "extracting": return activity.kind === "search" ? "Reading results" : "Extracting page";
    default: return "Working";
  }
}

function recentModel(entry: ActivityHistoryEntry, now: number): PopupRecentModel {
  const challenge = entry.outcome === "login" || entry.outcome === "captcha" || entry.outcome === "challenge";
  return {
    domain: entry.domain,
    when: relativeTime(entry.timestamp, now),
    duration: formatDuration(entry.duration),
    outcome: outcomeLabel(entry.outcome),
    symbol: entry.outcome === "completed" ? "✓" : challenge ? "🔒" : "!",
    tone: entry.outcome === "completed" ? "success" : challenge ? "challenge" : "error"
  };
}

function outcomeLabel(outcome: ActivityHistoryEntry["outcome"]): string {
  if (outcome === "completed") return "Completed";
  if (outcome === "login") return "Login required";
  if (outcome === "captcha") return "CAPTCHA encountered";
  if (outcome === "challenge") return "Access challenge";
  return "Error";
}

function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function labelForMode(mode: ToolbarMode, active: number): string {
  if (mode === "ready") return "Ready";
  if (mode === "searching") return "Searching";
  if (mode === "active") return `${active} active or queued`;
  if (mode === "challenge") return "Login or challenge encountered";
  return "Action needed";
}

function symbolForMode(mode: ToolbarMode): string {
  if (mode === "ready") return "✓";
  if (mode === "searching") return "S";
  if (mode === "active") return "↻";
  if (mode === "challenge") return "🔒";
  return "!";
}

function emptyConnectionStatus(): ConnectionStatus {
  return {
    connected: false,
    configured: false,
    message: "Open settings to connect",
    at: 0,
    transport: null,
    brokerVersion: null,
    brokerBuildId: null,
    protocolVersion: 0,
    lastHeartbeatAt: null
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : null;
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;
}

function finiteTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
