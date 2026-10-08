import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFullscreenShim, isFullscreenEventType } from "@/lib/fullscreen-shim";

const FLAG = "__xAutoPlaylistFullscreenShimInstalled";

type Entry = { type: string; listener: unknown; capture: boolean };

function capture(options: unknown): boolean {
  return typeof options === "boolean"
    ? options
    : Boolean((options as { capture?: boolean } | undefined)?.capture);
}

/** Minimal EventTarget with a native-like registry (dedupes identical listener/type/capture). */
class FakeTarget {
  entries: Entry[] = [];
  addEventListener(type: string, listener: unknown, options?: unknown): void {
    const c = capture(options);
    if (!this.entries.some((e) => e.type === type && e.listener === listener && e.capture === c)) {
      this.entries.push({ type, listener, capture: c });
    }
  }
  removeEventListener(type: string, listener: unknown, options?: unknown): void {
    const c = capture(options);
    this.entries = this.entries.filter(
      (e) => !(e.type === type && e.listener === listener && e.capture === c),
    );
  }
  dispatch(type: string, event: unknown): void {
    for (const e of this.entries.filter((x) => x.type === type)) {
      if (typeof e.listener === "function") {
        e.listener.call(this, event);
      } else {
        (e.listener as { handleEvent: (ev: unknown) => void }).handleEvent(event);
      }
    }
  }
}

describe("fullscreen listener wrapping", () => {
  let current: { tagName: string } | null;
  let target: FakeTarget;
  let doc: Document & { onfullscreenchange: unknown };
  let handlerSlot: unknown;
  let Target: typeof FakeTarget;

  beforeEach(() => {
    current = null;
    handlerSlot = null;
    Target = class extends FakeTarget {};
    // Give the subclass its own add/remove so patching does not leak between tests.
    Target.prototype.addEventListener = FakeTarget.prototype.addEventListener;
    Target.prototype.removeEventListener = FakeTarget.prototype.removeEventListener;
    const docProto = {};
    Object.defineProperty(docProto, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Object.defineProperty(docProto, "onfullscreenchange", {
      configurable: true,
      get: () => handlerSlot,
      set: (v: unknown) => {
        handlerSlot = v;
      },
    });
    doc = Object.create(docProto);
    vi.stubGlobal("Document", { prototype: docProto });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("EventTarget", Target);
    delete (globalThis as Record<string, unknown>)[FLAG];
    installFullscreenShim();
    target = new Target();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>)[FLAG];
  });

  it("recognises the fullscreen event types only", () => {
    expect(isFullscreenEventType("fullscreenchange")).toBe(true);
    expect(isFullscreenEventType("webkitfullscreenchange")).toBe(true);
    expect(isFullscreenEventType("fullscreenerror")).toBe(true);
    expect(isFullscreenEventType("click")).toBe(false);
  });

  it("skips page listeners while our host is fullscreen and calls them otherwise", () => {
    const listener = vi.fn(function (this: unknown) {
      expect(this).toBe(target);
    });
    target.addEventListener("fullscreenchange", listener);

    current = { tagName: "X-AUTO-PLAYLIST" };
    target.dispatch("fullscreenchange", "enter");
    expect(listener).not.toHaveBeenCalled();

    current = null; // our fullscreen exited
    target.dispatch("fullscreenchange", "exit");
    expect(listener).toHaveBeenCalledWith("exit");

    current = { tagName: "VIDEO" };
    target.dispatch("fullscreenchange", "video");
    expect(listener).toHaveBeenCalledWith("video");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("supports handleEvent objects with the object as this", () => {
    const obj = {
      calls: 0,
      handleEvent(this: { calls: number }) {
        this.calls += 1;
      },
    };
    target.addEventListener("webkitfullscreenchange", obj, { capture: true });
    current = { tagName: "x-auto-playlist" };
    target.dispatch("webkitfullscreenchange", {});
    expect(obj.calls).toBe(0);
    current = { tagName: "DIV" };
    target.dispatch("webkitfullscreenchange", {});
    expect(obj.calls).toBe(1);
    target.removeEventListener("webkitfullscreenchange", obj, true);
    expect(target.entries).toHaveLength(0);
  });

  it("removes wrapped listeners per type and capture", () => {
    const listener = vi.fn();
    target.addEventListener("fullscreenchange", listener);
    target.addEventListener("fullscreenchange", listener, true);
    target.addEventListener("fullscreenchange", listener); // duplicate, deduped
    expect(target.entries).toHaveLength(2);
    target.removeEventListener("fullscreenchange", listener, { capture: true });
    expect(target.entries).toHaveLength(1);
    expect(target.entries[0]?.capture).toBe(false);
    target.removeEventListener("fullscreenchange", listener);
    expect(target.entries).toHaveLength(0);
  });

  it("passes other event types through untouched", () => {
    const listener = vi.fn();
    target.addEventListener("click", listener);
    expect(target.entries[0]?.listener).toBe(listener);
    current = { tagName: "X-AUTO-PLAYLIST" };
    target.dispatch("click", "c");
    expect(listener).toHaveBeenCalledWith("c");
    target.removeEventListener("click", listener);
    expect(target.entries).toHaveLength(0);
  });

  it("wraps document.onfullscreenchange", () => {
    const handler = vi.fn();
    doc.onfullscreenchange = handler;
    expect(doc.onfullscreenchange).toBe(handler);
    expect(handlerSlot).not.toBe(handler);
    current = { tagName: "X-AUTO-PLAYLIST" };
    (handlerSlot as () => void)();
    expect(handler).not.toHaveBeenCalled();
    current = null;
    (handlerSlot as () => void)();
    expect(handler).toHaveBeenCalledTimes(1);
    doc.onfullscreenchange = null;
    expect(handlerSlot).toBeNull();
    expect(doc.onfullscreenchange).toBeNull();
  });
});
