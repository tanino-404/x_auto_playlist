import { describe, expect, it } from "vitest";
import { clampPanelWidth, mergeSettings, mergeUiPrefs } from "@/lib/store/merge";
import { PANEL } from "@/shared/constants";
import { DEFAULT_SETTINGS, DEFAULT_UI_PREFS } from "@/shared/types";

describe("mergeSettings", () => {
  it("returns the defaults when nothing was saved", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps saved values and fills in missing keys with defaults", () => {
    const saved = { mode: "manual", defaultVolume: 0.8 };
    const merged = mergeSettings(saved);
    expect(merged).toEqual({ ...DEFAULT_SETTINGS, mode: "manual", defaultVolume: 0.8 });
  });

  it("ignores keys with the wrong type and falls back to the default", () => {
    const saved = { mode: 123, theme: "dark" };
    const merged = mergeSettings(saved);
    expect(merged.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(merged.theme).toBe("dark");
  });

  it("ignores unknown keys", () => {
    const merged = mergeSettings({ notARealSetting: true });
    expect(merged).toEqual(DEFAULT_SETTINGS);
  });
});

describe("mergeUiPrefs", () => {
  it("returns the defaults when nothing was saved", () => {
    expect(mergeUiPrefs(undefined)).toEqual(DEFAULT_UI_PREFS);
  });

  it("clamps a saved panelWidth into range", () => {
    expect(mergeUiPrefs({ panelWidth: 10 }).panelWidth).toBe(PANEL.minWidth);
    expect(mergeUiPrefs({ panelWidth: 9000 }).panelWidth).toBe(PANEL.maxWidth);
  });

  it("keeps a valid saved playerWindow", () => {
    const playerWindow = { x: 1, y: 2, width: 480, height: 270 };
    expect(mergeUiPrefs({ playerWindow }).playerWindow).toEqual(playerWindow);
  });

  it("falls back to null for a malformed playerWindow", () => {
    expect(mergeUiPrefs({ playerWindow: { x: 1 } }).playerWindow).toBeNull();
  });
});

describe("clampPanelWidth", () => {
  it("clamps below the minimum", () => {
    expect(clampPanelWidth(PANEL.minWidth - 50)).toBe(PANEL.minWidth);
  });

  it("clamps above the maximum", () => {
    expect(clampPanelWidth(PANEL.maxWidth + 50)).toBe(PANEL.maxWidth);
  });

  it("passes values already in range through unchanged", () => {
    const inRange = (PANEL.minWidth + PANEL.maxWidth) / 2;
    expect(clampPanelWidth(inRange)).toBe(inRange);
  });
});
