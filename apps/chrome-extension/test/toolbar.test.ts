import { describe, expect, it, vi } from "vitest";
import { emptyActivityUiState, type ActivityUiState } from "../src/activity-state.js";
import { applyToolbarPresentation, toolbarPresentation, type ToolbarAction } from "../src/toolbar.js";

describe("toolbar badge states", () => {
  it("uses a green icon and an empty badge when ready", () => {
    expect(toolbarPresentation(emptyActivityUiState())).toMatchObject({
      mode: "ready",
      badgeText: "",
      badgeColor: "#18864b",
      title: expect.stringContaining("ready")
    });
  });

  it("uses a blue S while a single search is running", () => {
    expect(toolbarPresentation(stateWithActivity("searching"))).toMatchObject({
      mode: "searching",
      badgeText: "S",
      badgeColor: "#1769aa",
      title: expect.stringContaining("searching")
    });
  });

  it("uses a blue count for active or queued reads", () => {
    const state = stateWithActivity("navigating");
    state.activities.push({ ...state.activities[0]!, id: "second", phase: "queued" });
    expect(toolbarPresentation(state)).toMatchObject({ mode: "active", badgeText: "2", badgeColor: "#1769aa" });
  });

  it("uses symbol and title as well as color for errors and challenges", () => {
    expect(toolbarPresentation({
      ...emptyActivityUiState(),
      attention: "error",
      attentionSource: "activity"
    })).toMatchObject({ mode: "error", badgeText: "!", badgeColor: "#c4362b", title: expect.stringContaining("error") });

    expect(toolbarPresentation({
      ...emptyActivityUiState(),
      attention: "challenge",
      attentionSource: "activity",
      challengeKind: "login"
    })).toMatchObject({ mode: "challenge", badgeText: "🔒", badgeColor: "#d49a13", title: expect.stringContaining("login") });
  });

  it("applies accessible badge text, color, and title to the Chrome action", async () => {
    const action: ToolbarAction = {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setBadgeTextColor: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined)
    };
    const presentation = toolbarPresentation(stateWithActivity("searching"));
    await applyToolbarPresentation(action, presentation);
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: "S" });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#1769aa" });
    expect(action.setBadgeTextColor).toHaveBeenCalledWith({ color: "#ffffff" });
    expect(action.setTitle).toHaveBeenCalledWith({ title: expect.stringContaining("searching") });
  });
});

function stateWithActivity(phase: "queued" | "searching" | "navigating"): ActivityUiState {
  return {
    ...emptyActivityUiState(),
    activities: [{
      id: "first",
      kind: phase === "searching" ? "search" : "read",
      domain: "example.com",
      phase,
      queuedAt: 1_000,
      updatedAt: 2_000,
      source: { index: 1, total: 2 }
    }]
  };
}
