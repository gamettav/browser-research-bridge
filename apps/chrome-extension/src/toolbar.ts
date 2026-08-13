import type { ActivityUiState } from "./activity-state.js";

export type ToolbarMode = "ready" | "searching" | "active" | "error" | "challenge";

export type ToolbarPresentation = {
  mode: ToolbarMode;
  badgeText: string;
  badgeColor: string;
  badgeTextColor: string;
  iconColor: string;
  title: string;
};

export type ToolbarAction = {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  setBadgeTextColor?: (details: { color: string }) => Promise<void>;
  setTitle(details: { title: string }): Promise<void>;
  setIcon?: (details: { imageData: ImageData }) => Promise<void>;
};

const COLORS = {
  green: "#18864b",
  blue: "#1769aa",
  red: "#c4362b",
  yellow: "#d49a13",
  light: "#ffffff",
  dark: "#241b06"
} as const;

export function toolbarPresentation(state: ActivityUiState): ToolbarPresentation {
  const active = state.activities.length;
  if (active > 0) {
    const searching = active === 1 && state.activities[0]?.phase === "searching";
    return searching
      ? {
          mode: "searching",
          badgeText: "S",
          badgeColor: COLORS.blue,
          badgeTextColor: COLORS.light,
          iconColor: COLORS.blue,
          title: "Browser Research Bridge — searching"
        }
      : {
          mode: "active",
          badgeText: active > 99 ? "99+" : String(active),
          badgeColor: COLORS.blue,
          badgeTextColor: COLORS.light,
          iconColor: COLORS.blue,
          title: `Browser Research Bridge — ${active} active or queued read${active === 1 ? "" : "s"}`
        };
  }

  if (state.attention === "challenge") {
    const detail = state.challengeKind === "login"
      ? "login required"
      : state.challengeKind === "captcha"
        ? "CAPTCHA encountered"
        : "access challenge encountered";
    return {
      mode: "challenge",
      badgeText: "🔒",
      badgeColor: COLORS.yellow,
      badgeTextColor: COLORS.dark,
      iconColor: COLORS.yellow,
      title: `Browser Research Bridge — ${detail}`
    };
  }

  if (state.attention === "error") {
    return {
      mode: "error",
      badgeText: "!",
      badgeColor: COLORS.red,
      badgeTextColor: COLORS.light,
      iconColor: COLORS.red,
      title: "Browser Research Bridge — error"
    };
  }

  return {
    mode: "ready",
    badgeText: "",
    badgeColor: COLORS.green,
    badgeTextColor: COLORS.light,
    iconColor: COLORS.green,
    title: "Browser Research Bridge — ready"
  };
}

export async function applyToolbarPresentation(
  action: ToolbarAction,
  presentation: ToolbarPresentation,
  makeIcon?: (color: string) => ImageData
): Promise<void> {
  const operations: Promise<void>[] = [
    action.setBadgeText({ text: presentation.badgeText }),
    action.setBadgeBackgroundColor({ color: presentation.badgeColor }),
    action.setTitle({ title: presentation.title })
  ];
  if (action.setBadgeTextColor) operations.push(action.setBadgeTextColor({ color: presentation.badgeTextColor }));
  if (action.setIcon && makeIcon) operations.push(action.setIcon({ imageData: makeIcon(presentation.iconColor) }));
  await Promise.all(operations);
}

export function createToolbarIcon(color: string): ImageData {
  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Chrome did not provide a 2D canvas for the toolbar icon");
  context.clearRect(0, 0, size, size);
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(2, 2, 28, 28, 7);
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2.4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(9, 16);
  context.lineTo(23, 16);
  context.moveTo(18, 11);
  context.lineTo(23, 16);
  context.lineTo(18, 21);
  context.stroke();
  return context.getImageData(0, 0, size, size);
}
