import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ACTIVITY_HISTORY_KEY,
  ActivityStateController,
  emptyActivityUiState,
  readActivityHistory,
  readActivityUiState,
  sanitizeActivityHistory,
  type StorageAreaLike
} from "../src/activity-state.js";
import { buildPopupModel } from "../src/popup-model.js";

afterEach(() => vi.restoreAllMocks());

describe("popup model", () => {
  it("shows current domain, stage, elapsed time, queue position, diagnostics, and versions", () => {
    const model = buildPopupModel({
      ...emptyActivityUiState(),
      activities: [{
        id: "job",
        kind: "read",
        domain: "docs.example.com",
        phase: "extracting",
        queuedAt: 10_000,
        updatedAt: 14_000,
        source: { index: 2, total: 4 }
      }]
    }, [{ domain: "example.com", timestamp: 13_000, duration: 2_500, outcome: "completed" }], {
      connected: true,
      configured: true,
      message: "Connected via Native Messaging",
      at: 14_000,
      transport: "native",
      brokerVersion: "0.4.0",
      brokerBuildId: "build-safe",
      protocolVersion: 3,
      lastHeartbeatAt: 14_000
    }, "0.4.0", 15_000);

    expect(model.current).toEqual({
      active: true,
      domain: "docs.example.com",
      stage: "Extracting page",
      elapsed: "5s",
      queue: "2 of 4"
    });
    expect(model.recent[0]).toMatchObject({ domain: "example.com", duration: "2s", outcome: "Completed", symbol: "✓" });
    expect(model.connection).toMatchObject({ connected: true, transport: "Native Messaging", heartbeat: "Just now" });
    expect(model).toMatchObject({ extensionVersion: "0.4.0", brokerVersion: "0.4.0", brokerBuildId: "build-safe", protocolVersion: "3" });
  });

  it("strips every field except domain, timestamp, duration, and outcome from history", () => {
    const history = sanitizeActivityHistory([{
      domain: "example.com",
      timestamp: 1_000,
      duration: 500,
      outcome: "completed",
      query: "private search",
      url: "https://example.com/private?token=secret",
      pageText: "sensitive page",
      credentials: "never"
    }]);
    expect(history).toEqual([{ domain: "example.com", timestamp: 1_000, duration: 500, outcome: "completed" }]);
    expect(Object.keys(history[0]!).sort()).toEqual(["domain", "duration", "outcome", "timestamp"]);
    expect(sanitizeActivityHistory([{ domain: "https://example.com/?q=private", timestamp: 1, duration: 1, outcome: "error" }])).toEqual([]);
  });

  it("declares an action popup with keyboard-native controls and accessible status labels", async () => {
    const [manifestSource, html, css] = await Promise.all([
      readFile(new URL("../static/manifest.json", import.meta.url), "utf8"),
      readFile(new URL("../static/popup.html", import.meta.url), "utf8"),
      readFile(new URL("../static/popup.css", import.meta.url), "utf8")
    ]);
    const manifest = JSON.parse(manifestSource) as { action?: { default_popup?: string } };
    expect(manifest.action?.default_popup).toBe("popup.html");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Clear recent activity"');
    expect(html).toContain('aria-label="Run connection diagnostics"');
    expect(html).toContain('aria-label="Open Browser Research Bridge settings"');
    expect(html).not.toMatch(/tabindex="[1-9]/);
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("button:focus-visible");
  });
});

describe("MV3 worker restart with an open activity UI", () => {
  it("restores current activity from session storage and keeps history privacy-safe", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const firstWorker = new ActivityStateController({ session, local });
    await firstWorker.restore();
    await firstWorker.record({
      id: "job",
      kind: "search",
      domain: "duckduckgo.com",
      phase: "searching",
      queuedAt: 15_000,
      elapsedMs: 5_000,
      source: { index: 1, total: 3 }
    });

    const popupBeforeRestart = buildPopupModel(
      await readActivityUiState(session),
      await readActivityHistory(local),
      undefined,
      "0.4.0",
      20_000
    );
    expect(popupBeforeRestart.current).toMatchObject({ domain: "duckduckgo.com", stage: "Searching", elapsed: "5s", queue: "1 of 3" });

    // A new controller represents a freshly started MV3 worker. The popup uses
    // the same storage.session state and does not depend on the old worker heap.
    const restartedWorker = new ActivityStateController({ session, local });
    await restartedWorker.restore();
    const popupAfterRestart = buildPopupModel(
      await readActivityUiState(session),
      await readActivityHistory(local),
      undefined,
      "0.4.0",
      21_000
    );
    expect(popupAfterRestart.current).toMatchObject({ domain: "duckduckgo.com", stage: "Searching", elapsed: "6s", queue: "1 of 3" });

    vi.spyOn(Date, "now").mockReturnValue(22_000);
    await restartedWorker.record({
      id: "job",
      kind: "search",
      domain: "duckduckgo.com",
      phase: "completed",
      queuedAt: 15_000,
      elapsedMs: 7_000,
      source: { index: 1, total: 3 }
    });
    expect(await readActivityHistory(local)).toEqual([{
      domain: "duckduckgo.com",
      timestamp: 22_000,
      duration: 7_000,
      outcome: "completed"
    }]);

    await restartedWorker.clearHistory();
    expect((await local.get(ACTIVITY_HISTORY_KEY))[ACTIVITY_HISTORY_KEY]).toEqual([]);
  });
});

class MemoryStorage implements StorageAreaLike {
  private readonly values = new Map<string, unknown>();

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.map((key) => [key, this.values.get(key)]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.values.set(key, structuredClone(value));
  }
}
