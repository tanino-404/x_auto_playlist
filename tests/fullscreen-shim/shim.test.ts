import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFullscreenShim, shouldHideFullscreen } from "@/lib/fullscreen-shim";
import { UI_HOST_NAME } from "@/shared/constants";

const FLAG = "__xAutoPlaylistFullscreenShimInstalled";

function fakeElement(tagName: string): Element {
  return { tagName } as unknown as Element;
}

describe("shouldHideFullscreen", () => {
  it("is true only for the host tag (case-insensitive)", () => {
    expect(shouldHideFullscreen(fakeElement("X-AUTO-PLAYLIST"), UI_HOST_NAME)).toBe(true);
    expect(shouldHideFullscreen(fakeElement("x-auto-playlist"), UI_HOST_NAME)).toBe(true);
    expect(shouldHideFullscreen(fakeElement("VIDEO"), UI_HOST_NAME)).toBe(false);
    expect(shouldHideFullscreen(fakeElement("HTML"), UI_HOST_NAME)).toBe(false);
    expect(shouldHideFullscreen(null, UI_HOST_NAME)).toBe(false);
  });
});

describe("installFullscreenShim", () => {
  let current: Element | null;
  let doc: Document;

  beforeEach(() => {
    current = null;
    const proto = {};
    Object.defineProperty(proto, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Object.defineProperty(proto, "webkitFullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Object.defineProperty(proto, "webkitIsFullScreen", {
      configurable: true,
      get: () => current !== null,
    });
    doc = Object.create(proto) as Document;
    vi.stubGlobal("Document", { prototype: proto });
    vi.stubGlobal("document", doc);
    // Keep the real (Node) EventTarget unpatched.
    vi.stubGlobal("EventTarget", class {});
    delete (globalThis as Record<string, unknown>)[FLAG];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>)[FLAG];
  });

  it("hides our host's fullscreen state and passes through others", () => {
    installFullscreenShim();
    expect(doc.fullscreenElement).toBeNull();
    expect((doc as unknown as { webkitIsFullScreen: boolean }).webkitIsFullScreen).toBe(false);

    current = fakeElement("X-AUTO-PLAYLIST");
    expect(doc.fullscreenElement).toBeNull();
    expect(
      (doc as unknown as { webkitFullscreenElement: unknown }).webkitFullscreenElement,
    ).toBeNull();
    expect((doc as unknown as { webkitIsFullScreen: boolean }).webkitIsFullScreen).toBe(false);

    const video = fakeElement("VIDEO");
    current = video;
    expect(doc.fullscreenElement).toBe(video);
    expect((doc as unknown as { webkitFullscreenElement: unknown }).webkitFullscreenElement).toBe(
      video,
    );
    expect((doc as unknown as { webkitIsFullScreen: boolean }).webkitIsFullScreen).toBe(true);
  });

  it("defines configurable own properties and survives a second install", () => {
    installFullscreenShim();
    installFullscreenShim();
    expect(Object.getOwnPropertyDescriptor(doc, "fullscreenElement")?.configurable).toBe(true);
    current = fakeElement("x-auto-playlist");
    expect(doc.fullscreenElement).toBeNull();
    const div = fakeElement("DIV");
    current = div;
    expect(doc.fullscreenElement).toBe(div);
  });

  it("does nothing when the descriptors are missing", () => {
    const bare = Object.create({}) as Document;
    vi.stubGlobal("Document", { prototype: {} });
    vi.stubGlobal("document", bare);
    expect(() => installFullscreenShim()).not.toThrow();
    expect(Object.getOwnPropertyNames(bare)).toEqual([]);
  });
});
