import { describe, expect, it } from "vitest";
import { PLAYER_WINDOW } from "@/shared/constants";
import {
  clampRect,
  defaultRect,
  fullscreenRect,
  heightForWidth,
  PLAYER_MARGIN,
  PLAYER_MIN_WIDTH,
} from "@/ui/player-window/geometry";

const viewport = { width: 1920, height: 1080 };

describe("defaultRect", () => {
  it("sits bottom-right, left of the panel", () => {
    const rect = defaultRect(viewport, 360);
    expect(rect.width).toBe(PLAYER_WINDOW.defaultWidth);
    expect(rect.height).toBe(heightForWidth(PLAYER_WINDOW.defaultWidth));
    expect(rect.x + rect.width).toBe(1920 - 360 - PLAYER_MARGIN);
    expect(rect.y + rect.height).toBe(1080 - PLAYER_MARGIN);
  });
});

describe("clampRect", () => {
  it("keeps the window inside the viewport", () => {
    const rect = clampRect({ x: 5000, y: -50, width: 480, height: 300 }, viewport);
    expect(rect).toEqual({ x: 1920 - 480, y: 0, width: 480, height: 300 });
  });

  it("enforces the minimum and maximum size", () => {
    expect(clampRect({ x: 0, y: 0, width: 10, height: 10 }, viewport).width).toBe(PLAYER_MIN_WIDTH);
    expect(clampRect({ x: 0, y: 0, width: 9999, height: 9999 }, viewport)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });
});

describe("fullscreenRect", () => {
  it("fills everything except the panel", () => {
    expect(fullscreenRect(viewport, 360)).toEqual({ x: 0, y: 0, width: 1560, height: 1080 });
    expect(fullscreenRect(viewport, 0)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});
