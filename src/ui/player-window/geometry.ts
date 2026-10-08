// Pure geometry helpers for the floating player window. Dependency-free for unit tests.

import { PLAYER_WINDOW } from "@/shared/constants";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Height of the title bar (32) + seek row (12) + controls (40) in px. Must match player-window.css. */
export const PLAYER_CHROME_HEIGHT = 32 + 12 + 40;
export const PLAYER_MIN_WIDTH = 240;
export const PLAYER_MIN_HEIGHT = 135 + PLAYER_CHROME_HEIGHT;
/** Gap between the window and the viewport edge / panel in the default position. */
export const PLAYER_MARGIN = 16;

/** Height for a given width so the video area is 16:9. */
export function heightForWidth(width: number): number {
  return Math.round(width / PLAYER_WINDOW.aspectRatio) + PLAYER_CHROME_HEIGHT;
}

/** Default position: bottom-right, left of the panel when it is open. */
export function defaultRect(viewport: Viewport, panelWidth: number): Rect {
  const width = PLAYER_WINDOW.defaultWidth;
  const height = heightForWidth(width);
  return clampRect(
    {
      x: viewport.width - panelWidth - width - PLAYER_MARGIN,
      y: viewport.height - height - PLAYER_MARGIN,
      width,
      height,
    },
    viewport,
  );
}

/** Keeps the window fully inside the viewport (size first, then position). */
export function clampRect(rect: Rect, viewport: Viewport): Rect {
  const maxWidth = Math.max(PLAYER_MIN_WIDTH, viewport.width);
  const maxHeight = Math.max(PLAYER_MIN_HEIGHT, viewport.height);
  const width = Math.min(maxWidth, Math.max(PLAYER_MIN_WIDTH, rect.width));
  const height = Math.min(maxHeight, Math.max(PLAYER_MIN_HEIGHT, rect.height));
  const x = Math.min(Math.max(0, viewport.width - width), Math.max(0, rect.x));
  const y = Math.min(Math.max(0, viewport.height - height), Math.max(0, rect.y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Fullscreen layout: everything except the panel, no margin. */
export function fullscreenRect(viewport: Viewport, panelWidth: number): Rect {
  return { x: 0, y: 0, width: Math.max(0, viewport.width - panelWidth), height: viewport.height };
}
