// Pure helpers for src/lib/store/index.ts. Kept dependency-free so they are easy to unit test.

import { PANEL } from "@/shared/constants";
import type { Settings, UiPrefs } from "@/shared/types";
import { DEFAULT_SETTINGS, DEFAULT_UI_PREFS } from "@/shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Clamp a candidate panel width into [PANEL.minWidth, PANEL.maxWidth]. */
export function clampPanelWidth(px: number): number {
  if (Number.isNaN(px)) {
    return PANEL.defaultWidth;
  }
  return Math.min(PANEL.maxWidth, Math.max(PANEL.minWidth, px));
}

/**
 * Merge a value read from chrome.storage.local (key "settings", of unknown shape
 * since storage is untyped) with DEFAULT_SETTINGS. Keys missing from `saved`, or
 * present with the wrong type, fall back to the default.
 */
export function mergeSettings(saved: unknown): Settings {
  if (!isRecord(saved)) {
    return { ...DEFAULT_SETTINGS };
  }
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const value = saved[key];
    if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
      // Keys of Settings are all string/number/boolean, so the typeof check above
      // is sufficient to keep this assignment sound.
      (merged as Record<keyof Settings, unknown>)[key] = value;
    }
  }
  return merged;
}

/** Same idea as mergeSettings, but for UiPrefs (including the nested playerWindow). */
export function mergeUiPrefs(saved: unknown): UiPrefs {
  if (!isRecord(saved)) {
    return { ...DEFAULT_UI_PREFS };
  }
  const merged: UiPrefs = { ...DEFAULT_UI_PREFS };

  if (typeof saved.panelWidth === "number") {
    merged.panelWidth = clampPanelWidth(saved.panelWidth);
  }
  if (typeof saved.panelOpen === "boolean") {
    merged.panelOpen = saved.panelOpen;
  }
  const playerWindow = saved.playerWindow;
  if (
    isRecord(playerWindow) &&
    typeof playerWindow.x === "number" &&
    typeof playerWindow.y === "number" &&
    typeof playerWindow.width === "number" &&
    typeof playerWindow.height === "number"
  ) {
    merged.playerWindow = {
      x: playerWindow.x,
      y: playerWindow.y,
      width: playerWindow.width,
      height: playerWindow.height,
    };
  } else if (playerWindow === null) {
    merged.playerWindow = null;
  }

  return merged;
}
