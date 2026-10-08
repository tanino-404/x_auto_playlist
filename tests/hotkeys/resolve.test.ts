import { describe, expect, it } from "vitest";
import type { HotkeyContext, HotkeyEvent } from "@/lib/hotkeys";
import { isEditingTarget, resolveHotkey } from "@/lib/hotkeys";

const ctx: HotkeyContext = { editing: false, enabled: true, panelOpen: true, hasCurrent: true };

function key(k: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return {
    key: k,
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  };
}

describe("resolveHotkey", () => {
  it.each([
    [key(" ", { code: "Space" }), "toggle-play"],
    [key("ArrowLeft"), "seek-backward"],
    [key("ArrowRight"), "seek-forward"],
    [key("ArrowLeft", { shiftKey: true }), "prev"],
    [key("ArrowRight", { shiftKey: true }), "next"],
    [key("ArrowUp"), "volume-up"],
    [key("ArrowDown"), "volume-down"],
    [key("f"), "fullscreen"],
    [key("F"), "fullscreen"],
    [key("m"), "mute"],
    [key("l"), "loop"],
    [key("s"), "shuffle"],
    [key("p"), "pip"],
  ] as const)("%o -> %s", (event, action) => {
    expect(resolveHotkey(event, ctx)).toBe(action);
  });

  it("falls back to the physical key code for letters (non-latin layouts)", () => {
    expect(resolveHotkey(key("а", { code: "KeyF" }), ctx)).toBe("fullscreen");
    expect(resolveHotkey(key("Unidentified", { code: "Space" }), ctx)).toBe("toggle-play");
  });

  it("ignores keys that are not assigned (x.com's j / k etc.)", () => {
    expect(resolveHotkey(key("j"), ctx)).toBeNull();
    expect(resolveHotkey(key("k"), ctx)).toBeNull();
    expect(resolveHotkey(key("Enter"), ctx)).toBeNull();
    expect(resolveHotkey(key("Escape"), ctx)).toBeNull();
  });

  it("returns null while editing", () => {
    expect(resolveHotkey(key(" "), { ...ctx, editing: true })).toBeNull();
    expect(resolveHotkey(key("ArrowLeft"), { ...ctx, editing: true })).toBeNull();
  });

  it("returns null with Ctrl / Meta / Alt", () => {
    expect(resolveHotkey(key("f", { ctrlKey: true }), ctx)).toBeNull();
    expect(resolveHotkey(key("ArrowLeft", { metaKey: true }), ctx)).toBeNull();
    expect(resolveHotkey(key(" ", { altKey: true }), ctx)).toBeNull();
  });

  it("returns null with Shift except on the left / right arrows", () => {
    expect(resolveHotkey(key("F", { shiftKey: true }), ctx)).toBeNull();
    expect(resolveHotkey(key(" ", { shiftKey: true }), ctx)).toBeNull();
    expect(resolveHotkey(key("ArrowUp", { shiftKey: true }), ctx)).toBeNull();
  });

  it("returns null when disabled or nothing is loaded", () => {
    expect(resolveHotkey(key(" "), { ...ctx, enabled: false })).toBeNull();
    expect(resolveHotkey(key(" "), { ...ctx, hasCurrent: false })).toBeNull();
  });

  it("stays enabled while the panel is closed, as long as something is loaded", () => {
    expect(resolveHotkey(key(" "), { ...ctx, panelOpen: false })).toBe("toggle-play");
    expect(resolveHotkey(key("ArrowLeft"), { ...ctx, panelOpen: false })).toBe("seek-backward");
  });

  it("repeats seek / volume but not toggles", () => {
    expect(resolveHotkey(key("ArrowRight", { repeat: true }), ctx)).toBe("seek-forward");
    expect(resolveHotkey(key("ArrowUp", { repeat: true }), ctx)).toBe("volume-up");
    expect(resolveHotkey(key(" ", { repeat: true }), ctx)).toBeNull();
    expect(resolveHotkey(key("m", { repeat: true }), ctx)).toBeNull();
    expect(resolveHotkey(key("ArrowRight", { shiftKey: true, repeat: true }), ctx)).toBeNull();
  });
});

describe("isEditingTarget", () => {
  it("is false for non-elements", () => {
    expect(isEditingTarget(null)).toBe(false);
    expect(isEditingTarget(undefined)).toBe(false);
  });
});
