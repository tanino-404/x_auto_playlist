// Keyboard shortcuts (F-48 / S-17, docs/architecture.md §6.7). ISOLATED world.
// One capture-phase keydown listener on document. Active only while the setting is on and
// there is a current item (the player window is shown); the panel may be open or closed. Keys
// typed into text fields are left alone; only handled keys are stopped, so x.com's own
// shortcuts (j / k / ...) keep working.

import type { Player } from "@/lib/player";
import type { Store } from "@/lib/store";
import { SEEK_STEP_SECONDS, UI_HOST_NAME, VOLUME_STEP } from "@/shared/constants";

export type HotkeyAction =
  | "toggle-play"
  | "seek-backward"
  | "seek-forward"
  | "prev"
  | "next"
  | "volume-up"
  | "volume-down"
  | "fullscreen"
  | "mute"
  | "loop"
  | "shuffle"
  | "pip";

export interface HotkeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Auto-repeat. Toggles ignore it; seek / volume repeat. */
  repeat?: boolean;
}

export interface HotkeyContext {
  /** Focus is in a text field (input / textarea / select / contenteditable / textbox). */
  editing: boolean;
  /** settings.hotkeys */
  enabled: boolean;
  /** Unused by resolveHotkey (kept for compatibility / debug hooks). */
  panelOpen: boolean;
  /** playback.currentId !== null (the player window is shown). */
  hasCurrent: boolean;
}

const LETTER_ACTIONS: Readonly<Record<string, HotkeyAction>> = {
  f: "fullscreen",
  m: "mute",
  l: "loop",
  s: "shuffle",
  p: "pip",
};

/** Letter of a key: `key` (layout aware), else the physical `code` ("KeyF" -> "f"). */
function letterOf(event: HotkeyEvent): string | null {
  if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
    return event.key.toLowerCase();
  }
  const match = /^Key([A-Z])$/.exec(event.code);
  return match?.[1] === undefined ? null : match[1].toLowerCase();
}

/** Maps a keydown to an action, or null when it must be left to the page. Pure. */
export function resolveHotkey(event: HotkeyEvent, ctx: HotkeyContext): HotkeyAction | null {
  if (!ctx.enabled || !ctx.hasCurrent || ctx.editing) {
    return null;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  const repeat = event.repeat === true;
  switch (event.key) {
    case "ArrowLeft":
      if (event.shiftKey) {
        return repeat ? null : "prev";
      }
      return "seek-backward";
    case "ArrowRight":
      if (event.shiftKey) {
        return repeat ? null : "next";
      }
      return "seek-forward";
    case "ArrowUp":
      return event.shiftKey ? null : "volume-up";
    case "ArrowDown":
      return event.shiftKey ? null : "volume-down";
    default:
      break;
  }
  if (event.shiftKey || repeat) {
    return null;
  }
  if (event.key === " " || event.key === "Spacebar" || event.code === "Space") {
    return "toggle-play";
  }
  const letter = letterOf(event);
  return letter === null ? null : (LETTER_ACTIONS[letter] ?? null);
}

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(", ");

/** True when the innermost event target (composedPath()[0]) is, or is inside, a text field. */
export function isEditingTarget(target: EventTarget | null | undefined): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return target.closest(EDITABLE_SELECTOR) !== null;
}

/** The context of `event` for resolveHotkey(). Also used by the debug hooks. */
export function hotkeyContext(store: Store, event: Event | null): HotkeyContext {
  const target = event === null ? null : event.composedPath()[0];
  return {
    editing: isEditingTarget(target),
    enabled: store.settings.peek().hotkeys,
    panelOpen: store.panelOpen.peek(),
    hasCurrent: store.playback.peek().currentId !== null,
  };
}

/** Fullscreen target: our UI root inside the shadow host. */
function fullscreenRoot(): Element | null {
  return document.querySelector(UI_HOST_NAME)?.shadowRoot?.querySelector(".xap-root") ?? null;
}

/** Runs `action` synchronously (fullscreen / PiP need the keydown's user activation). */
export function runHotkeyAction(action: HotkeyAction, store: Store, player: Player): void {
  switch (action) {
    case "toggle-play":
      player.togglePlay();
      break;
    case "seek-backward":
      player.seekBy(-SEEK_STEP_SECONDS);
      break;
    case "seek-forward":
      player.seekBy(SEEK_STEP_SECONDS);
      break;
    case "prev":
      player.prev();
      break;
    case "next":
      player.next();
      break;
    case "volume-up":
      player.setVolume(store.playback.peek().volume + VOLUME_STEP);
      break;
    case "volume-down":
      player.setVolume(store.playback.peek().volume - VOLUME_STEP);
      break;
    case "fullscreen": {
      const root = fullscreenRoot();
      if (root !== null) {
        void player.toggleFullscreen(root);
      }
      break;
    }
    case "mute":
      player.toggleMute();
      break;
    case "loop":
      player.cycleLoop();
      break;
    case "shuffle":
      player.toggleShuffle();
      break;
    case "pip":
      void player.togglePictureInPicture();
      break;
  }
}

/** Installs the shortcuts. Returns a function that removes the listener. */
export function installHotkeys(deps: { store: Store; player: Player }): () => void {
  const { store, player } = deps;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) {
      return;
    }
    const action = resolveHotkey(event, hotkeyContext(store, event));
    if (action === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    runHotkeyAction(action, store, player);
  };
  document.addEventListener("keydown", onKeyDown, true);
  return () => document.removeEventListener("keydown", onKeyDown, true);
}
