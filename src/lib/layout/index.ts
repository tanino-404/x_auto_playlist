// Split view instead of an overlay (docs/architecture.md §7.1, requirements F-10 / F-19).
// Pushes x.com's own document to the left by the panel's width, instead of drawing the panel
// on top of it. x.com's layout is centered / fluid, so shrinking `html`'s width is enough for
// it to re-flow on its own (it falls back to its own narrow-viewport layout when squeezed).

import { UI_HOST_NAME } from "@/shared/constants";

export interface PageLayout {
  /** `panelWidthPx` is the panel's current width, or `null` while the panel is closed. */
  apply(panelWidthPx: number | null): void;
  /** Restores the document to its original width. */
  dispose(): void;
}

/**
 * Pure: the CSS `width` to give `document.documentElement`, or `null` to remove the override.
 * `viewportWidth` is not needed for the calc() itself (percentages already account for it) but
 * is kept in the signature for parity with callers that measure the viewport before calling in.
 */
export function computeDocumentWidth(
  viewportWidth: number,
  panelWidth: number | null,
): string | null {
  void viewportWidth;
  return panelWidth === null ? null : `calc(100% - ${panelWidth}px)`;
}

/** True while `doc.fullscreenElement` is our own shadow host (docs/architecture.md §7.1 / T-06). */
function isOwnFullscreen(doc: Document): boolean {
  const el = doc.fullscreenElement;
  if (!el) {
    return false;
  }
  return el.tagName.toLowerCase() === UI_HOST_NAME;
}

export function createPageLayout(doc: Document = document): PageLayout {
  const root = doc.documentElement;

  const setWidth = (value: string | null) => {
    if (value === null) {
      root.style.removeProperty("width");
    } else {
      root.style.setProperty("width", value, "important");
    }
  };

  return {
    apply(panelWidthPx) {
      // Our own fullscreen container already covers the whole viewport (player + panel); leave
      // the document width alone while it's active instead of fighting it.
      if (isOwnFullscreen(doc)) {
        return;
      }
      setWidth(computeDocumentWidth(0, panelWidthPx));
    },
    dispose() {
      setWidth(null);
    },
  };
}
