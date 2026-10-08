import { describe, expect, it, vi } from "vitest";
import { createPageLayout } from "@/lib/layout";

/** Minimal fake Document: just enough of documentElement.style for createPageLayout(). */
function createFakeDocument(fullscreenElement: { tagName: string } | null = null): Document {
  const style = {
    setProperty: vi.fn(),
    removeProperty: vi.fn(),
  };
  return {
    documentElement: { style },
    fullscreenElement,
  } as unknown as Document;
}

describe("createPageLayout", () => {
  it("apply(width) sets an !important calc() width", () => {
    const doc = createFakeDocument();
    const layout = createPageLayout(doc);

    layout.apply(360);

    const style = doc.documentElement.style;
    expect(style.setProperty).toHaveBeenCalledWith("width", "calc(100% - 360px)", "important");
    expect(style.removeProperty).not.toHaveBeenCalled();
  });

  it("apply(null) removes the width override", () => {
    const doc = createFakeDocument();
    const layout = createPageLayout(doc);

    layout.apply(360);
    layout.apply(null);

    expect(doc.documentElement.style.removeProperty).toHaveBeenCalledWith("width");
  });

  it("dispose() removes the width override", () => {
    const doc = createFakeDocument();
    const layout = createPageLayout(doc);

    layout.apply(360);
    layout.dispose();

    expect(doc.documentElement.style.removeProperty).toHaveBeenCalledWith("width");
  });

  it("does not touch the width while our own fullscreen container is active", () => {
    const doc = createFakeDocument({ tagName: "X-AUTO-PLAYLIST" });
    const layout = createPageLayout(doc);

    layout.apply(360);

    expect(doc.documentElement.style.setProperty).not.toHaveBeenCalled();
    expect(doc.documentElement.style.removeProperty).not.toHaveBeenCalled();
  });

  it("still applies width when a different element (e.g. X's own video) is fullscreen", () => {
    const doc = createFakeDocument({ tagName: "VIDEO" });
    const layout = createPageLayout(doc);

    layout.apply(360);

    expect(doc.documentElement.style.setProperty).toHaveBeenCalledWith(
      "width",
      "calc(100% - 360px)",
      "important",
    );
  });
});
