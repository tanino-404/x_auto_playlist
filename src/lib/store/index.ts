// The single place application state lives (ISOLATED world). See docs/architecture.md §4/§5.

import type { ReadonlySignal, Signal } from "@preact/signals";
import { batch, computed, effect, signal, untracked } from "@preact/signals";
import type { CollectorStatus, RateLimitState } from "@/lib/store/collector-state";
import { INITIAL_RATE_LIMIT, nextRateLimit } from "@/lib/store/collector-state";
import { clampPanelWidth, mergeSettings, mergeUiPrefs } from "@/lib/store/merge";
import type { AddPosition, PlaylistState } from "@/lib/store/playlist";
import {
  applyPostFlags,
  createInitialPlaylist,
  insertItems,
  manualInsertAnchor,
  moveAfter,
  moveIndex,
  parseManualPlaylist,
  playedIdsToRemove,
  removeFromManual,
  removeManyFromManual,
  selectVisibleItems,
} from "@/lib/store/playlist";
import type { InterceptedResponse } from "@/shared/messages";
import type {
  ManualPlaylist,
  PlaybackState,
  PlaylistItem,
  PostFlags,
  Settings,
  UiPrefs,
} from "@/shared/types";
import { DEFAULT_SETTINGS, DEFAULT_UI_PREFS } from "@/shared/types";

export type { CollectorStatus, RateLimitState } from "@/lib/store/collector-state";
export { clampPanelWidth, mergeSettings, mergeUiPrefs } from "@/lib/store/merge";
export type { AddPosition, PlaylistState } from "@/lib/store/playlist";

const STORAGE_KEYS = { settings: "settings", uiPrefs: "uiPrefs" } as const;
const SESSION_KEYS = { manualPlaylist: "manualPlaylist" } as const;
const SAVE_DEBOUNCE_MS = 300;

export type PlayerWindowRect = NonNullable<UiPrefs["playerWindow"]>;

/**
 * PlaybackState (src/shared/types.ts) plus stage-3 fields that live only in the store.
 * - awaitingMore: auto mode reached the end and waits for the collector to add items.
 * - lastError: one-line message shown in the player window (toasts come in stage 6).
 */
export interface StorePlaybackState extends PlaybackState {
  awaitingMore: boolean;
  lastError: string | null;
}

/** One-line message for the UI (toasts arrive in stage 6). `at` is epoch ms. */
export interface Notice {
  kind: "info" | "error";
  text: string;
  at: number;
}

export interface Store {
  settings: Signal<Settings>;
  uiPrefs: Signal<UiPrefs>;
  playlist: Signal<PlaylistState>;
  playback: Signal<StorePlaybackState>;
  /** Player window chrome visibility (false while auto-hidden in fullscreen). Written by the UI. */
  controlsVisible: Signal<boolean>;
  /** Derived from uiPrefs.value.panelOpen. */
  panelOpen: ReadonlySignal<boolean>;
  /** settings.mode === "auto" ? playlist.auto.items : playlist.manual.items */
  visibleItems: ReadonlySignal<PlaylistItem[]>;
  /** The item matching playback.currentId inside visibleItems, or null. */
  currentItem: ReadonlySignal<PlaylistItem | null>;
  /** visibleItems.length */
  itemCount: ReadonlySignal<number>;
  togglePanel(): void;
  setPanelOpen(open: boolean): void;
  setPanelWidth(px: number): void;
  setPlayerWindowRect(rect: PlayerWindowRect | null): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Dedupes by id when settings.dedupe is true. "next" inserts right after playback.currentId. */
  addItems(items: PlaylistItem[], target: "auto" | "manual", position?: AddPosition): void;
  /** Removes from the list currently shown (per settings.mode). */
  removeItem(id: string): void;
  /** Empties the list currently shown (per settings.mode). */
  clearPlaylist(): void;
  /**
   * F-13: moves manual.items[from] to index `to` (indices into manual.items, which is the
   * visible list in manual mode). No-op for out-of-range indices.
   */
  moveItem(from: number, to: number): void;
  /**
   * Row menu "次に再生": in manual mode moves `id` right after the playing / last played item
   * (front when there is none); in auto mode adds the item to the manual list ("next").
   */
  playNext(id: string): void;
  /**
   * S-18 "remove" (F-26): removes played items other than the playing one from the list
   * currently shown. Runs automatically whenever playback moves on while
   * settings.playedHandling === "remove".
   */
  removePlayed(): void;
  select(id: string | null): void;
  /** Shallow-merges into playback. Used by the player. */
  updatePlayback(patch: Partial<StorePlaybackState>): void;
  /** Collector health (requirements N-04). "broken" makes the panel show a banner. */
  collectorStatus: Signal<CollectorStatus>;
  setCollectorStatus(status: CollectorStatus): void;
  /** Last x-rate-limit-* headers seen. `limitedUntil` is epoch ms (set on HTTP 429). */
  rateLimit: Signal<RateLimitState>;
  setRateLimit(rateLimit: InterceptedResponse["rateLimit"], status: number): void;
  /**
   * SPA navigation (§6.5): empties auto.items and sets auto.pageKey. playback.currentId is
   * kept so the playing item keeps playing (currentItem still resolves it).
   */
  resetAutoPlaylist(pageKey: string): void;
  /** Latest user-facing notice (e.g. right-click add result), or null. */
  notice: Signal<Notice | null>;
  /** Sets the notice (`at` is stamped now); null clears it. */
  setNotice(notice: Omit<Notice, "at"> | null): void;
  /**
   * F-4C: merges `patch` into the `post` flags of every item (auto and manual, plus the
   * detached playing item) whose postId matches.
   */
  setPostFlags(postId: string, patch: Partial<PostFlags>): void;
}

function initialPlayback(settings: Settings): StorePlaybackState {
  return {
    status: "idle",
    currentId: null,
    selectedId: null,
    loop: settings.defaultLoop,
    shuffle: false,
    volume: settings.defaultVolume,
    muted: false,
    speed: 1,
    quality: settings.defaultQuality,
    playedIds: [],
    consecutiveErrors: 0,
    awaitingMore: false,
    lastError: null,
  };
}

async function readStoredSettingsAndUiPrefs(): Promise<{ settings: Settings; uiPrefs: UiPrefs }> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.uiPrefs]);
    return {
      settings: mergeSettings(stored[STORAGE_KEYS.settings]),
      uiPrefs: mergeUiPrefs(stored[STORAGE_KEYS.uiPrefs]),
    };
  } catch (error) {
    console.warn("x-auto-playlist: failed to read chrome.storage.local", error);
    return { settings: { ...DEFAULT_SETTINGS }, uiPrefs: { ...DEFAULT_UI_PREFS } };
  }
}

async function readStoredManualPlaylist(): Promise<ManualPlaylist> {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEYS.manualPlaylist);
    return parseManualPlaylist(stored[SESSION_KEYS.manualPlaylist]);
  } catch (error) {
    console.warn("x-auto-playlist: failed to read chrome.storage.session", error);
    return parseManualPlaylist(undefined);
  }
}

function debouncedSave<T>(
  area: chrome.storage.StorageArea,
  areaName: string,
  key: string,
  read: () => T,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  return effect(() => {
    const snapshot = read();
    if (first) {
      // The initial value was just read from storage; no need to write it back.
      first = false;
      return;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      area.set({ [key]: snapshot }).catch((error: unknown) => {
        console.warn(
          `x-auto-playlist: failed to save "${key}" to chrome.storage.${areaName}`,
          error,
        );
      });
    }, SAVE_DEBOUNCE_MS);
  });
}

export async function initStore(): Promise<Store> {
  const [initial, manual] = await Promise.all([
    readStoredSettingsAndUiPrefs(),
    readStoredManualPlaylist(),
  ]);

  const settings = signal<Settings>(initial.settings);
  const uiPrefs = signal<UiPrefs>(initial.uiPrefs);
  const playlist = signal<PlaylistState>({
    ...createInitialPlaylist(initial.settings.mode),
    manual,
  });
  const playback = signal<StorePlaybackState>(initialPlayback(initial.settings));
  const controlsVisible = signal(true);

  const panelOpen = computed(() => uiPrefs.value.panelOpen);
  const visibleItems = computed(() => selectVisibleItems(playlist.value, settings.value.mode));
  const itemCount = computed(() => visibleItems.value.length);
  const collectorStatus = signal<CollectorStatus>("unknown");
  const rateLimit = signal<RateLimitState>({ ...INITIAL_RATE_LIMIT });
  const notice = signal<Notice | null>(null);
  // The playing auto item that resetAutoPlaylist() removed from the list, so the player
  // window can keep showing it until playback moves on.
  const detachedCurrent = signal<PlaylistItem | null>(null);

  const currentItem = computed(() => {
    const id = playback.value.currentId;
    if (id === null) {
      return null;
    }
    const found = visibleItems.value.find((item) => item.id === id);
    if (found !== undefined) {
      return found;
    }
    const detached = detachedCurrent.value;
    return detached !== null && detached.id === id ? detached : null;
  });

  // settings.mode is the source of truth; mirror it into playlist.mode.
  effect(() => {
    const mode = settings.value.mode;
    const current = playlist.peek();
    if (current.mode !== mode) {
      playlist.value = { ...current, mode };
    }
  });

  debouncedSave(chrome.storage.local, "local", STORAGE_KEYS.settings, () => settings.value);
  debouncedSave(chrome.storage.local, "local", STORAGE_KEYS.uiPrefs, () => uiPrefs.value);
  // Via computed so that changes to playlist.auto do not trigger a session write.
  const manualSnapshot = computed(() => playlist.value.manual);
  debouncedSave(
    chrome.storage.session,
    "session",
    SESSION_KEYS.manualPlaylist,
    () => manualSnapshot.value,
  );

  const updatePlayback = (patch: Partial<StorePlaybackState>) => {
    playback.value = { ...playback.value, ...patch };
  };

  function removePlayed(): void {
    const current = playlist.peek();
    const mode = settings.peek().mode;
    const { playedIds, currentId, selectedId } = playback.peek();
    const ids = playedIdsToRemove(selectVisibleItems(current, mode), playedIds, currentId);
    if (ids.length === 0) {
      return;
    }
    const drop = new Set(ids);
    batch(() => {
      if (mode === "auto") {
        const items = current.auto.items.filter((item) => !drop.has(item.id));
        playlist.value = { ...current, auto: { ...current.auto, items } };
      } else {
        playlist.value = { ...current, manual: removeManyFromManual(current.manual, ids) };
      }
      if (selectedId !== null && drop.has(selectedId)) {
        updatePlayback({ selectedId: null });
      }
    });
  }

  // S-18 "remove": drop played items as soon as playback moves on (currentId / playedIds
  // change) or the setting is switched to "remove". Reading .value subscribes to the whole
  // settings / playback signals, so mode switches re-run it too; the check itself is O(n).
  effect(() => {
    const { playedHandling } = settings.value;
    const { playedIds } = playback.value;
    if (playedHandling === "remove" && playedIds.length > 0) {
      untracked(removePlayed);
    }
  });

  const store: Store = {
    settings,
    uiPrefs,
    playlist,
    playback,
    controlsVisible,
    panelOpen,
    visibleItems,
    currentItem,
    itemCount,
    togglePanel() {
      uiPrefs.value = { ...uiPrefs.value, panelOpen: !uiPrefs.value.panelOpen };
    },
    setPanelOpen(open) {
      uiPrefs.value = { ...uiPrefs.value, panelOpen: open };
    },
    setPanelWidth(px) {
      uiPrefs.value = { ...uiPrefs.value, panelWidth: clampPanelWidth(px) };
    },
    setPlayerWindowRect(rect) {
      uiPrefs.value = { ...uiPrefs.value, playerWindow: rect === null ? null : { ...rect } };
    },
    updateSettings(patch) {
      settings.value = { ...settings.value, ...patch };
    },
    addItems(items, target, position = "end") {
      const current = playlist.value;
      const { currentId } = playback.value;
      const dedupe = settings.value.dedupe;
      if (target === "auto") {
        const next = insertItems(current.auto.items, items, { position, currentId, dedupe });
        if (next !== current.auto.items) {
          playlist.value = { ...current, auto: { ...current.auto, items: next } };
        }
      } else {
        const next = insertItems(current.manual.items, items, {
          position,
          currentId: manualInsertAnchor(current.manual, currentId),
          dedupe,
        });
        if (next !== current.manual.items) {
          playlist.value = { ...current, manual: { ...current.manual, items: next } };
        }
      }
    },
    removeItem(id) {
      const current = playlist.value;
      if (settings.value.mode === "auto") {
        const items = current.auto.items.filter((item) => item.id !== id);
        if (items.length === current.auto.items.length) {
          return;
        }
        playlist.value = { ...current, auto: { ...current.auto, items } };
      } else {
        const manual = removeFromManual(current.manual, id);
        if (manual === current.manual) {
          return;
        }
        playlist.value = { ...current, manual };
      }
      if (playback.value.selectedId === id) {
        updatePlayback({ selectedId: null });
      }
    },
    clearPlaylist() {
      const current = playlist.value;
      if (settings.value.mode === "auto") {
        playlist.value = { ...current, auto: { ...current.auto, items: [] } };
      } else {
        playlist.value = { ...current, manual: { items: [], lastPlayedId: null } };
      }
      updatePlayback({ selectedId: null });
    },
    moveItem(from, to) {
      const current = playlist.value;
      const items = moveIndex(current.manual.items, from, to);
      if (items !== current.manual.items) {
        playlist.value = {
          ...current,
          manual: { ...current.manual, items: items as PlaylistItem[] },
        };
      }
    },
    playNext(id) {
      const current = playlist.value;
      if (settings.value.mode === "manual") {
        const anchor = manualInsertAnchor(current.manual, playback.value.currentId);
        const items = moveAfter(current.manual.items, id, anchor);
        if (items !== current.manual.items) {
          playlist.value = { ...current, manual: { ...current.manual, items } };
        }
        return;
      }
      const item = current.auto.items.find((candidate) => candidate.id === id);
      if (item === undefined) {
        return;
      }
      const before = current.manual.items.length;
      store.addItems([item], "manual", "next");
      const added = playlist.value.manual.items.length > before;
      store.setNotice({
        kind: "info",
        text: added ? "手動プレイリストに追加しました" : "手動プレイリストに追加済みです",
      });
    },
    removePlayed,
    select(id) {
      updatePlayback({ selectedId: id });
    },
    updatePlayback,
    collectorStatus,
    setCollectorStatus(status) {
      if (collectorStatus.peek() !== status) {
        collectorStatus.value = status;
      }
    },
    rateLimit,
    setRateLimit(next, status) {
      rateLimit.value = nextRateLimit(rateLimit.peek(), next, status, Date.now());
    },
    resetAutoPlaylist(pageKey) {
      const current = playlist.peek();
      const { currentId, selectedId } = playback.peek();
      const playing = current.auto.items.find((item) => item.id === currentId);
      if (playing !== undefined) {
        detachedCurrent.value = playing;
      }
      playlist.value = { ...current, auto: { pageKey, items: [] } };
      if (
        selectedId !== null &&
        current.auto.items.some((item) => item.id === selectedId) &&
        !current.manual.items.some((item) => item.id === selectedId)
      ) {
        updatePlayback({ selectedId: null });
      }
    },
    notice,
    setNotice(next) {
      notice.value = next === null ? null : { ...next, at: Date.now() };
    },
    setPostFlags(postId, patch) {
      batch(() => {
        const current = playlist.peek();
        const autoItems = applyPostFlags(current.auto.items, postId, patch);
        const manualItems = applyPostFlags(current.manual.items, postId, patch);
        if (autoItems !== current.auto.items || manualItems !== current.manual.items) {
          playlist.value = {
            ...current,
            auto: { ...current.auto, items: autoItems },
            manual: { ...current.manual, items: manualItems },
          };
        }
        const detached = detachedCurrent.peek();
        if (detached !== null) {
          const [next] = applyPostFlags([detached], postId, patch);
          if (next !== undefined && next !== detached) {
            detachedCurrent.value = next;
          }
        }
      });
    },
  };
  return store;
}
