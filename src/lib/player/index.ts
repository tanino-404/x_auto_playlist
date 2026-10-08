// Playback control (ISOLATED world). docs/architecture.md §6.2 / §6.3 / §7.2.
// Two <video> elements (A/B double buffering, §6.3) for videos / GIFs and one <img> for
// photos, advancing through the playlist (loop / shuffle), progress signals, quality
// selection, error skipping and prefetching of the next item (S-12).

import type { ReadonlySignal } from "@preact/signals";
import { effect, signal } from "@preact/signals";
import {
  bufferedEnd,
  isTimedKind,
  nextLoopMode,
  normalizeSpeed,
  photoUrl,
  qualityLabel,
  roundVolume,
  sameQuality,
  selectSource,
} from "@/lib/player/logic";
import type { NextPlan, PrefetchCandidate } from "@/lib/player/prefetch";
import {
  canUsePrefetched,
  decideNextPlanned,
  decidePrevSkipping,
  planNext,
  planPrefetch,
} from "@/lib/player/prefetch";
import type { Store } from "@/lib/store";
import { MAX_CONSECUTIVE_ERRORS, SCROLL } from "@/shared/constants";
import type { MediaSource, PlaylistItem, Quality } from "@/shared/types";

export * from "@/lib/player/logic";
export * from "@/lib/player/prefetch";

export const MESSAGES = {
  unplayable: "この動画は再生できない形式です",
  error: "再生できませんでした。次へ進みます",
  tooManyErrors: "再生エラーが続いたため停止しました",
  nothingPlayable: "再生できる項目がありません",
} as const;

/** How long a transient lastError stays visible (ms). */
const TRANSIENT_ERROR_MS = 5000;
/** Progress signals are updated at most this often from timeupdate / the image timer. */
const PROGRESS_INTERVAL_MS = 250;

export interface PrefetchState {
  /** Item being prefetched as "next", or null. */
  nextId: string | null;
  /** True once the next item has enough data (video: HAVE_CURRENT_DATA, photo: decoded). */
  ready: boolean;
}

export interface Player {
  /** Creates the two <video> and the <img> inside `container`. Calling again replaces them. */
  attach(container: HTMLElement): void;
  detach(): void;
  /** User-initiated start (play button / double click, F-16). Clears error state. */
  play(id: string): Promise<void>;
  pause(): void;
  resume(): void;
  /** playing → pause, paused → resume, idle → replay the current item. */
  togglePlay(): void;
  /** Stops and clears currentId (closes the player window). */
  stop(): void;
  /** Next item. No-op while nothing has been played (F-16). */
  next(): void;
  /** Restart when 3 s or more have played, else the previous playable item. */
  prev(): void;
  seek(seconds: number): void;
  seekBy(deltaSeconds: number): void;
  /** 0..1, rounded to VOLUME_STEP. A non-zero value unmutes. */
  setVolume(volume: number): void;
  toggleMute(): void;
  setSpeed(speed: number): void;
  /** all → one → off → all */
  cycleLoop(): void;
  toggleShuffle(): void;
  /** Reloads the current video at the same position / play state. */
  setQuality(quality: Quality): void;
  /** requestFullscreen on `target`, or exit when already fullscreen. Call from a user gesture. */
  toggleFullscreen(target: Element): Promise<void>;
  isFullscreen(): boolean;
  togglePictureInPicture(): Promise<void>;
  /** True while the element passed to toggleFullscreen() is fullscreen (not X's own player). */
  readonly fullscreen: ReadonlySignal<boolean>;
  /** Seconds. For photos / GIFs: time elapsed of the display duration (S-04). */
  readonly currentTime: ReadonlySignal<number>;
  readonly duration: ReadonlySignal<number>;
  /** End (seconds) of the buffered range around the playhead. */
  readonly buffered: ReadonlySignal<number>;
  /** "720p" for the source being played, or null (photos / unknown resolution). */
  readonly resolvedQualityLabel: ReadonlySignal<string | null>;
  /** Prefetch of the next item (audit / debug). */
  readonly prefetchState: ReadonlySignal<PrefetchState>;
  /** The <video> on screen (the other one is the hidden prefetch buffer). */
  readonly videoElement: HTMLVideoElement | null;
  readonly imageElement: HTMLImageElement | null;
}

interface Loaded {
  item: PlaylistItem;
  /** Position to start from once the element is ready. */
  startAt: number;
  autoplay: boolean;
}

/** Wall-clock timer for photos / GIFs (S-04). */
interface TimedState {
  duration: number;
  elapsed: number;
  /** performance.now() when the timer last (re)started, null while paused. */
  runningSince: number | null;
}

/** What the spare <video> holds. */
interface SpareContent {
  id: string;
  url: string;
  role: "next" | "prev";
}

const SPARE_EVENTS = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough", "error"];

export function createPlayer(deps: { store: Store; random?: () => number }): Player {
  const { store } = deps;
  const random = deps.random ?? Math.random;

  let container: HTMLElement | null = null;
  /** The <video> on screen. */
  let video: HTMLVideoElement | null = null;
  /** The hidden buffer <video> (prefetch target). */
  let spare: HTMLVideoElement | null = null;
  let img: HTMLImageElement | null = null;
  /** What should be on screen. Applied on attach() when set before the window mounted. */
  let loaded: Loaded | null = null;
  /** True once `loaded` has been applied to the current elements. */
  let applied = false;
  /** Incremented on every load; stale element events compare against it. */
  let generation = 0;
  /** Generation whose item has started playing (prefetch starts only after that). */
  let startedGeneration = -1;
  let timed: TimedState | null = null;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let awaitTimer: ReturnType<typeof setTimeout> | undefined;
  let errorClearTimer: ReturnType<typeof setTimeout> | undefined;
  let lastProgressAt = 0;
  /** Unplayable items skipped in a row (safety bound against loops). */
  let skipStreak = 0;
  /**
   * Unplayable items skipped in the current shuffle round. They are not "played" (they stay
   * out of playback.playedIds) but must not be drawn again in the same round.
   */
  const skipped = new Set<string>();
  /** Our own src switches can emit "pause"; ignore it until the new source plays. */
  let switching = false;
  /** Next item decided ahead of time (fixed shuffle draw, §6.3). */
  let plan: NextPlan | null = null;
  let spareContent: SpareContent | null = null;
  /** Photos warmed up with new Image(), by URL. */
  let imagePrefetches = new Map<string, HTMLImageElement>();
  /** Our <video> in picture-in-picture (document.pictureInPictureElement is retargeted). */
  let pipVideo: HTMLVideoElement | null = null;

  let fullscreenTarget: Element | null = null;
  const fullscreen = signal(false);
  const currentTime = signal(0);
  const duration = signal(0);
  const buffered = signal(0);
  const resolvedQualityLabel = signal<string | null>(null);
  const prefetchState = signal<PrefetchState>({ nextId: null, ready: false });

  // document.fullscreenElement is retargeted to the shadow host, so ask the target itself.
  document.addEventListener("fullscreenchange", () => {
    const active = fullscreenTarget?.matches(":fullscreen") ?? false;
    if (!active) {
      fullscreenTarget = null;
    }
    fullscreen.value = active;
  });

  const status = () => store.playback.peek().status;
  const imageDuration = () => Math.min(20, Math.max(1, store.settings.peek().imageDurationSec));
  const isVideoKind = () => loaded !== null && !isTimedKind(loaded.item);
  const usesVideoElement = () => loaded !== null && loaded.item.kind !== "photo";

  const setPrefetchState = (next: PrefetchState) => {
    const current = prefetchState.peek();
    if (current.nextId !== next.nextId || current.ready !== next.ready) {
      prefetchState.value = next;
    }
  };

  // ---- error line -------------------------------------------------------------------------

  const setLastError = (message: string | null, transient: boolean) => {
    if (errorClearTimer !== undefined) {
      clearTimeout(errorClearTimer);
      errorClearTimer = undefined;
    }
    store.updatePlayback({ lastError: message });
    if (message !== null && transient) {
      errorClearTimer = setTimeout(() => {
        errorClearTimer = undefined;
        if (store.playback.peek().lastError === message) {
          store.updatePlayback({ lastError: null });
        }
      }, TRANSIENT_ERROR_MS);
    }
  };

  // ---- timers -----------------------------------------------------------------------------

  const clearAwait = () => {
    if (awaitTimer !== undefined) {
      clearTimeout(awaitTimer);
      awaitTimer = undefined;
    }
  };

  const stopTick = () => {
    if (tickTimer !== undefined) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };

  const timedElapsed = (state: TimedState) =>
    state.elapsed +
    (state.runningSince === null ? 0 : (performance.now() - state.runningSince) / 1000);

  const tick = () => {
    const state = timed;
    if (!state) {
      stopTick();
      return;
    }
    const elapsed = Math.min(state.duration, timedElapsed(state));
    currentTime.value = elapsed;
    if (elapsed >= state.duration && state.runningSince !== null) {
      state.elapsed = state.duration;
      state.runningSince = null;
      stopTick();
      advance("auto");
    }
  };

  const startTimed = (startAt: number, running: boolean) => {
    stopTick();
    const total = imageDuration();
    timed = {
      duration: total,
      elapsed: Math.min(total, Math.max(0, startAt)),
      runningSince: running ? performance.now() : null,
    };
    duration.value = total;
    buffered.value = total;
    currentTime.value = timed.elapsed;
    if (running) {
      tickTimer = setInterval(tick, PROGRESS_INTERVAL_MS);
    }
  };

  const pauseTimed = () => {
    if (timed && timed.runningSince !== null) {
      timed.elapsed = timedElapsed(timed);
      timed.runningSince = null;
      stopTick();
      currentTime.value = Math.min(timed.duration, timed.elapsed);
    }
  };

  const resumeTimed = () => {
    if (timed && timed.runningSince === null) {
      if (timed.elapsed >= timed.duration) {
        timed.elapsed = 0;
      }
      timed.runningSince = performance.now();
      stopTick();
      tickTimer = setInterval(tick, PROGRESS_INTERVAL_MS);
    }
  };

  // ---- element events ---------------------------------------------------------------------

  const updateProgress = (force: boolean) => {
    if (!video || !isVideoKind()) {
      return;
    }
    const now = performance.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) {
      return;
    }
    lastProgressAt = now;
    currentTime.value = video.currentTime;
    buffered.value = bufferedEnd(video.buffered, video.currentTime);
  };

  const updateDuration = () => {
    if (!video || !isVideoKind() || !loaded) {
      return;
    }
    const value = video.duration;
    duration.value =
      Number.isFinite(value) && value > 0 ? value : (loaded.item.durationMs ?? 0) / 1000;
  };

  /** Applies a pending start position once the on-screen video has metadata. */
  const applyStartAt = () => {
    const current = loaded;
    if (video && current && current.startAt > 0 && isVideoKind() && video.readyState >= 1) {
      video.currentTime = Math.min(
        current.startAt,
        Number.isFinite(video.duration) ? video.duration : current.startAt,
      );
      current.startAt = 0;
    }
  };

  const onTimeUpdate = () => updateProgress(false);
  const onSeeked = () => updateProgress(true);
  const onProgress = () => {
    if (video && isVideoKind()) {
      buffered.value = bufferedEnd(video.buffered, video.currentTime);
    }
  };
  const onLoadedMetadata = () => {
    updateDuration();
    applyStartAt();
    updateProgress(true);
  };
  const onPlaying = () => {
    switching = false;
    if (store.playback.peek().consecutiveErrors !== 0) {
      store.updatePlayback({ consecutiveErrors: 0 });
    }
    if (usesVideoElement() && startedGeneration !== generation) {
      startedGeneration = generation;
      refreshPrefetch();
    }
  };
  const onEnded = () => {
    if (isVideoKind()) {
      updateProgress(true);
      advance("auto");
    }
  };
  const onVideoError = () => {
    if (!usesVideoElement()) {
      return;
    }
    const error = video?.error;
    console.warn("x-auto-playlist: video error", error?.code, error?.message);
    handleError();
  };
  const onImageLoad = () => {
    if (loaded?.item.kind === "photo" && store.playback.peek().consecutiveErrors !== 0) {
      store.updatePlayback({ consecutiveErrors: 0 });
    }
  };
  const onImageError = () => {
    if (loaded?.item.kind !== "photo" || !img?.getAttribute("src")) {
      return;
    }
    console.warn("x-auto-playlist: image failed to load", img.src);
    handleError();
  };
  const onPause = () => {
    // Reflect pauses we did not initiate (e.g. from the PiP window).
    if (switching || !video || video.ended || !usesVideoElement()) {
      return;
    }
    if (status() === "playing" && !store.playback.peek().awaitingMore) {
      pauseTimed();
      store.updatePlayback({ status: "paused" });
    }
  };
  const onPlay = () => {
    if (status() === "paused" && usesVideoElement()) {
      resumeTimed();
      store.updatePlayback({ status: "playing" });
    }
  };

  /** Handlers of the on-screen element; events from the spare element are ignored. */
  const activeHandlers: ReadonlyMap<string, () => void> = new Map([
    ["ended", onEnded],
    ["error", onVideoError],
    ["pause", onPause],
    ["play", onPlay],
    ["playing", onPlaying],
    ["timeupdate", onTimeUpdate],
    ["seeked", onSeeked],
    ["progress", onProgress],
    ["loadedmetadata", onLoadedMetadata],
    ["durationchange", updateDuration],
  ]);
  const onVideoEvent = (event: Event) => {
    if (event.currentTarget === video) {
      activeHandlers.get(event.type)?.();
    }
  };

  // Spare element: readiness of the prefetch, and dropping a prefetch that failed.
  const onSpareEvent = (event: Event) => {
    const el = event.currentTarget;
    if (el !== spare || spare === null || spareContent === null) {
      return;
    }
    if (event.type === "error") {
      console.warn("x-auto-playlist: prefetch failed", spareContent.url);
      spareContent = null;
      clearElement(spare);
    }
    updateReady();
  };

  const onEnterPip = (event: Event) => {
    pipVideo = event.currentTarget as HTMLVideoElement;
  };
  const onLeavePip = (event: Event) => {
    if (pipVideo === event.currentTarget) {
      pipVideo = null;
    }
  };

  // Volume / mute / speed follow the store. GIFs are always muted.
  const applyAudio = () => {
    if (!video) {
      return;
    }
    const { volume, muted, speed } = store.playback.peek();
    video.volume = Math.min(1, Math.max(0, volume));
    video.muted = muted || loaded?.item.kind === "gif";
    video.playbackRate = speed;
    video.defaultPlaybackRate = speed;
  };
  effect(() => {
    const { volume, muted, speed } = store.playback.value;
    void volume;
    void muted;
    void speed;
    applyAudio();
  });

  // ---- sources ----------------------------------------------------------------------------

  /** The mp4 that playback of `item` uses (the same rule for playback and prefetch). */
  const sourceFor = (item: PlaylistItem): MediaSource | null => {
    // Physical pixels of the video area: CSS width × devicePixelRatio.
    const width = (container?.clientWidth ?? 0) * (window.devicePixelRatio || 1);
    return selectSource(item.sources, store.playback.peek().quality, width > 0 ? width : null);
  };

  const isPlayableItem = (item: PlaylistItem) => {
    if (!item.playable) {
      return false;
    }
    if (item.kind === "photo") {
      return photoUrl(item) !== null;
    }
    return selectSource(item.sources, "highest", null) !== null;
  };

  const isPlayableId = (id: string) => {
    const item = store.visibleItems.peek().find((entry) => entry.id === id);
    return item !== undefined && isPlayableItem(item);
  };

  // ---- loading ----------------------------------------------------------------------------

  const playVideo = (el: HTMLVideoElement, gen: number) => {
    el.play().catch((error: unknown) => {
      if (gen !== generation) {
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        // Interrupted by a new load; not a real failure.
        return;
      }
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        // Autoplay policy: wait for the user to press play.
        switching = false;
        pauseTimed();
        store.updatePlayback({ status: "paused" });
        return;
      }
      // Unsupported sources also fire "error" on the element, which handles skipping.
      console.warn("x-auto-playlist: video.play() failed", error);
    });
  };

  /** Empties an element and releases its media resources. */
  function clearElement(el: HTMLVideoElement) {
    if (el.getAttribute("src")) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
  }

  const clearVideo = () => {
    if (video) {
      clearElement(video);
    }
  };

  const clearSpare = () => {
    spareContent = null;
    if (spare) {
      clearElement(spare);
    }
  };

  const clearPrefetch = () => {
    clearSpare();
    imagePrefetches = new Map();
    setPrefetchState({ nextId: null, ready: false });
  };

  /**
   * Brings the spare <video> (which already holds the next source) on screen and sends the
   * old one back to be the spare, emptied to free its memory. Audio settings / loop are
   * applied by the caller; picture-in-picture moves to the new element.
   */
  const swapToSpare = () => {
    const old = video;
    const next = spare;
    if (!old || !next) {
      return;
    }
    video = next;
    spare = old;
    spareContent = null;
    old.pause();
    old.hidden = true;
    next.hidden = false;
    next.preload = "auto";
    if (pipVideo === old) {
      // Allowed without a user gesture while a picture-in-picture window is open.
      next
        .requestPictureInPicture()
        .catch((error: unknown) => {
          console.warn("x-auto-playlist: could not move picture-in-picture", error);
        })
        .finally(() => {
          if (spare === old && spareContent === null) {
            clearElement(old);
          }
        });
    } else {
      clearElement(old);
    }
    setPrefetchState({ nextId: null, ready: false });
  };

  /** Puts `loaded` on screen. Requires attached elements. */
  const apply = () => {
    const current = loaded;
    if (!current || !video || !img) {
      return;
    }
    applied = true;
    const gen = generation;
    const { item } = current;
    const autoplay = current.autoplay;

    if (item.kind === "photo") {
      clearVideo();
      video.hidden = true;
      img.hidden = false;
      resolvedQualityLabel.value = null;
      img.src = photoUrl(item) ?? "";
      startTimed(current.startAt, autoplay);
      current.startAt = 0;
      if (autoplay) {
        startedGeneration = gen;
        refreshPrefetch();
      }
      return;
    }

    img.hidden = true;
    img.removeAttribute("src");
    const source = sourceFor(item);
    if (source === null) {
      video.hidden = false;
      return;
    }
    let swapped = false;
    if (
      video.getAttribute("src") !== source.url &&
      store.settings.peek().prefetch !== "off" &&
      canUsePrefetched(spare?.getAttribute("src"), source.url)
    ) {
      swapToSpare();
      swapped = true;
    }
    video.hidden = false;
    resolvedQualityLabel.value = qualityLabel(source);
    video.loop = item.kind === "gif";
    applyAudio();

    if (item.kind === "gif") {
      startTimed(current.startAt, autoplay);
      current.startAt = 0;
    } else {
      stopTick();
      timed = null;
      duration.value = (item.durationMs ?? 0) / 1000;
      currentTime.value = current.startAt;
      buffered.value = 0;
    }

    if (swapped) {
      // Already loaded: loadedmetadata will not fire again.
      if (item.kind === "video") {
        if (current.startAt > 0) {
          applyStartAt();
        } else if (video.readyState >= 1 && video.currentTime !== 0) {
          video.currentTime = 0;
        }
      }
      updateDuration();
      updateProgress(true);
      switching = autoplay;
    } else if (video.getAttribute("src") !== source.url) {
      switching = autoplay;
      video.src = source.url;
    } else if (item.kind === "video") {
      video.currentTime = current.startAt;
      current.startAt = 0;
    }
    if (autoplay) {
      playVideo(video, gen);
    } else {
      video.pause();
    }
  };

  const markPlaying = (item: PlaylistItem, record: boolean) => {
    const { playedIds } = store.playback.peek();
    store.updatePlayback({
      currentId: item.id,
      status: "playing",
      awaitingMore: false,
      // Skipping an unplayable item is not playing it.
      playedIds: !record || playedIds.includes(item.id) ? playedIds : [...playedIds, item.id],
    });
    if (record && store.settings.peek().mode === "manual") {
      const playlist = store.playlist.peek();
      store.playlist.value = { ...playlist, manual: { ...playlist.manual, lastPlayedId: item.id } };
    }
  };

  /** Stops with the "nothing playable" message. */
  const stopNothingPlayable = () => {
    skipStreak = 0;
    loaded = null;
    pauseTimed();
    stopTick();
    clearVideo();
    clearPrefetch();
    store.updatePlayback({ status: "idle", awaitingMore: false });
    setLastError(MESSAGES.nothingPlayable, false);
  };

  /** Starts `item`. Unplayable items are skipped with a notice (not counted as errors). */
  const startItem = (item: PlaylistItem, startAt = 0) => {
    generation++;
    clearAwait();
    stopTick();
    timed = null;

    if (!isPlayableItem(item)) {
      skipStreak++;
      skipped.add(item.id);
      markPlaying(item, false);
      const visible = store.visibleItems.peek();
      if (!visible.some(isPlayableItem) || skipStreak > Math.max(1, visible.length) * 2 + 1) {
        stopNothingPlayable();
        return;
      }
      setLastError(MESSAGES.unplayable, true);
      advance("user");
      return;
    }
    skipStreak = 0;
    markPlaying(item, true);
    loaded = { item, startAt, autoplay: true };
    applied = false;
    setPrefetchState({ nextId: null, ready: false });
    if (video && img) {
      apply();
    }
    // Otherwise the player window mounts (currentId is set) and calls attach().
  };

  const idsOfVisible = () => store.visibleItems.peek().map((item) => item.id);
  const findVisible = (id: string) => store.visibleItems.peek().find((item) => item.id === id);

  /** Inputs of the next decision. Skipped items count as played for the shuffle draw. */
  const nextInput = (ids: readonly string[]) => {
    const playback = store.playback.peek();
    return {
      ids,
      currentId: playback.currentId,
      loop: playback.loop,
      shuffle: playback.shuffle,
      playedIds: skipped.size === 0 ? playback.playedIds : [...playback.playedIds, ...skipped],
      random,
    };
  };

  const resetPlayed = () => {
    skipped.clear();
    store.updatePlayback({ playedIds: [] });
  };

  /** Moves past the current item (§6.2). */
  function advance(reason: "auto" | "user") {
    const playback = store.playback.peek();
    const ids = idsOfVisible();
    const decision = decideNextPlanned({ ...nextInput(ids), reason }, plan);
    plan = null;
    if (decision.resetPlayed) {
      resetPlayed();
    }
    const nextItem = decision.id === null ? undefined : findVisible(decision.id);
    if (nextItem !== undefined) {
      startItem(nextItem);
      return;
    }
    // End of the list. Auto mode waits for more items (the scroller loads them);
    // a detached current item (SPA navigation) just stops (§6.5).
    pauseTimed();
    stopTick();
    if (video && !video.paused) {
      video.pause();
    }
    const inList = playback.currentId !== null && ids.includes(playback.currentId);
    if (store.settings.peek().mode === "auto" && inList) {
      store.updatePlayback({ awaitingMore: true, status: "playing" });
      clearAwait();
      awaitTimer = setTimeout(() => {
        awaitTimer = undefined;
        if (store.playback.peek().awaitingMore) {
          store.updatePlayback({ awaitingMore: false, status: "idle" });
        }
      }, SCROLL.loadTimeoutMs);
    } else {
      store.updatePlayback({ awaitingMore: false, status: "idle" });
    }
  }

  // Resume automatically when items arrive while waiting at the end of the auto playlist.
  effect(() => {
    const items = store.visibleItems.value;
    const playback = store.playback.peek();
    if (!playback.awaitingMore || items.length === 0) {
      return;
    }
    const decision = decideNextPlanned(
      { ...nextInput(items.map((item) => item.id)), reason: "user" },
      plan,
    );
    const nextItem =
      decision.id === null ? undefined : items.find((item) => item.id === decision.id);
    if (nextItem !== undefined && nextItem.id !== playback.currentId) {
      plan = null;
      if (decision.resetPlayed) {
        resetPlayed();
      }
      startItem(nextItem);
    }
  });

  // Switching to manual mode while waiting for more auto items ends the wait.
  effect(() => {
    const { mode } = store.settings.value;
    if (mode !== "auto" && store.playback.peek().awaitingMore) {
      clearAwait();
      store.updatePlayback({ awaitingMore: false, status: "idle" });
    }
  });

  // ---- prefetch (§6.3) --------------------------------------------------------------------

  const candidateOf = (item: PlaylistItem | undefined): PrefetchCandidate | null => {
    if (item === undefined || !isPlayableItem(item)) {
      return null;
    }
    const url = item.kind === "photo" ? photoUrl(item) : (sourceFor(item)?.url ?? null);
    return url === null ? null : { id: item.id, kind: item.kind, url };
  };

  function updateReady() {
    const { nextId } = prefetchState.peek();
    if (nextId === null) {
      return;
    }
    let ready = false;
    if (spareContent !== null && spareContent.id === nextId && spareContent.role === "next") {
      ready = (spare?.readyState ?? 0) >= 2;
    } else {
      const item = findVisible(nextId);
      const url = item?.kind === "photo" ? photoUrl(item) : null;
      const image = url === null ? undefined : imagePrefetches.get(url);
      ready = image?.complete === true && image.naturalWidth > 0;
    }
    setPrefetchState({ nextId, ready });
  }

  /**
   * Loads the next item (and with "both" the previous one, lightly) into the spare <video>
   * or an Image. Runs once the current item has started playing. Idempotent: a spare that
   * already holds the right URL is left alone.
   */
  function refreshPrefetch() {
    const current = loaded;
    const setting = store.settings.peek().prefetch;
    if (setting === "off" || !current) {
      plan = null;
      clearPrefetch();
      return;
    }
    if (!video || !spare || startedGeneration !== generation || status() === "idle") {
      return;
    }
    const ids = idsOfVisible();
    const input = nextInput(ids);
    plan = planNext(input, plan);
    const nextItem = plan.id === null ? undefined : findVisible(plan.id);
    let prevItem: PlaylistItem | undefined;
    if (setting === "both") {
      const prev = decidePrevSkipping(
        {
          ids,
          currentId: input.currentId,
          loop: input.loop,
          shuffle: input.shuffle,
          playedIds: store.playback.peek().playedIds,
          currentTime: 0,
        },
        isPlayableId,
      );
      prevItem = prev.type === "play" ? findVisible(prev.id) : undefined;
    }
    const currentUrl = usesVideoElement() ? video.getAttribute("src") : photoUrl(current.item);
    const targets = planPrefetch(
      setting,
      { id: current.item.id, url: currentUrl },
      candidateOf(nextItem),
      candidateOf(prevItem),
    );

    // Spare <video>.
    const wanted = targets.video;
    if (wanted === null) {
      clearSpare();
    } else {
      if (spare.getAttribute("src") !== wanted.url) {
        spare.pause();
        spare.muted = true;
        spare.preload = wanted.preload;
        spare.src = wanted.url;
      } else if (spare.preload !== wanted.preload) {
        spare.preload = wanted.preload;
      }
      spareContent = {
        id: wanted.id,
        url: wanted.url,
        role: wanted.id === targets.nextId ? "next" : "prev",
      };
    }

    // Photos.
    const images = new Map<string, HTMLImageElement>();
    for (const target of targets.images) {
      let image = imagePrefetches.get(target.url);
      if (image === undefined) {
        image = new Image();
        image.decoding = "async";
        image.addEventListener("load", updateReady);
        image.src = target.url;
      }
      images.set(target.url, image);
    }
    imagePrefetches = images;

    setPrefetchState({ nextId: targets.nextId, ready: false });
    updateReady();
  }

  // Re-plan when the setting, the order rules, the quality or the list change.
  effect(() => {
    const { prefetch } = store.settings.value;
    const { shuffle, loop, quality } = store.playback.value;
    const items = store.visibleItems.value;
    void prefetch;
    void shuffle;
    void loop;
    void quality;
    void items;
    refreshPrefetch();
  });

  function handleError() {
    const errors = store.playback.peek().consecutiveErrors + 1;
    if (errors >= MAX_CONSECUTIVE_ERRORS) {
      generation++;
      switching = false;
      pauseTimed();
      stopTick();
      clearVideo();
      clearPrefetch();
      store.updatePlayback({ consecutiveErrors: errors, status: "idle", awaitingMore: false });
      setLastError(MESSAGES.tooManyErrors, false);
      return;
    }
    store.updatePlayback({ consecutiveErrors: errors });
    setLastError(MESSAGES.error, true);
    advance("user");
  }

  /** Clears error state for an explicit user action. */
  const userAction = () => {
    skipStreak = 0;
    const playback = store.playback.peek();
    if (playback.lastError !== null || playback.consecutiveErrors !== 0) {
      store.updatePlayback({ consecutiveErrors: 0 });
      setLastError(null, false);
    }
  };

  // ---- elements ---------------------------------------------------------------------------

  const createVideoElement = () => {
    const el = document.createElement("video");
    el.playsInline = true;
    el.preload = "auto";
    el.controls = false;
    el.className = "xap-video";
    for (const type of activeHandlers.keys()) {
      el.addEventListener(type, onVideoEvent);
    }
    for (const type of SPARE_EVENTS) {
      el.addEventListener(type, onSpareEvent);
    }
    el.addEventListener("enterpictureinpicture", onEnterPip);
    el.addEventListener("leavepictureinpicture", onLeavePip);
    return el;
  };

  const destroyVideoElement = (el: HTMLVideoElement) => {
    for (const type of activeHandlers.keys()) {
      el.removeEventListener(type, onVideoEvent);
    }
    for (const type of SPARE_EVENTS) {
      el.removeEventListener(type, onSpareEvent);
    }
    el.removeEventListener("enterpictureinpicture", onEnterPip);
    el.removeEventListener("leavepictureinpicture", onLeavePip);
    el.pause();
    el.removeAttribute("src");
    el.load();
    el.remove();
  };

  const destroyElements = () => {
    stopTick();
    if (video) {
      destroyVideoElement(video);
      video = null;
    }
    if (spare) {
      destroyVideoElement(spare);
      spare = null;
    }
    spareContent = null;
    pipVideo = null;
    imagePrefetches = new Map();
    setPrefetchState({ nextId: null, ready: false });
    if (img) {
      img.removeEventListener("load", onImageLoad);
      img.removeEventListener("error", onImageError);
      img.remove();
      img = null;
    }
    container = null;
    applied = false;
    startedGeneration = -1;
  };

  const currentPosition = () => {
    if (timed) {
      return timedElapsed(timed);
    }
    return video?.currentTime ?? 0;
  };

  const api: Player = {
    get fullscreen() {
      return fullscreen;
    },
    get currentTime() {
      return currentTime;
    },
    get duration() {
      return duration;
    },
    get buffered() {
      return buffered;
    },
    get resolvedQualityLabel() {
      return resolvedQualityLabel;
    },
    get prefetchState() {
      return prefetchState;
    },
    get videoElement() {
      return video;
    },
    get imageElement() {
      return img;
    },

    attach(target) {
      // Keep the playhead of whatever was showing so a re-attach does not restart it.
      const resumeAt = applied ? currentPosition() : null;
      destroyElements();
      container = target;
      const a = createVideoElement();
      const b = createVideoElement();
      b.hidden = true;
      b.muted = true;
      const image = document.createElement("img");
      image.className = "xap-image";
      image.alt = "";
      image.decoding = "async";
      image.hidden = true;
      image.addEventListener("load", onImageLoad);
      image.addEventListener("error", onImageError);
      target.appendChild(a);
      target.appendChild(b);
      target.appendChild(image);
      video = a;
      spare = b;
      img = image;
      applyAudio();
      if (loaded) {
        if (resumeAt !== null) {
          loaded.startAt = resumeAt;
        }
        loaded.autoplay = status() === "playing" && !store.playback.peek().awaitingMore;
        apply();
      }
    },

    detach() {
      destroyElements();
    },

    async play(id) {
      const item =
        findVisible(id) ?? (store.currentItem.peek()?.id === id ? store.currentItem.peek() : null);
      if (!item) {
        console.warn(`x-auto-playlist: play(): item "${id}" is not in the playlist`);
        return;
      }
      userAction();
      plan = null;
      startItem(item);
    },

    pause() {
      const playback = store.playback.peek();
      if (playback.awaitingMore) {
        clearAwait();
        store.updatePlayback({ awaitingMore: false, status: "idle" });
        return;
      }
      if (playback.status !== "playing") {
        return;
      }
      pauseTimed();
      if (usesVideoElement()) {
        video?.pause();
      }
      store.updatePlayback({ status: "paused" });
    },

    resume() {
      if (status() !== "paused" || !loaded) {
        return;
      }
      if (!applied) {
        loaded.autoplay = true;
        store.updatePlayback({ status: "playing" });
        apply();
        return;
      }
      store.updatePlayback({ status: "playing" });
      resumeTimed();
      if (usesVideoElement() && video) {
        playVideo(video, generation);
      } else if (startedGeneration !== generation) {
        // A photo that was shown paused (autoplay blocked / re-attach) starts now.
        startedGeneration = generation;
        refreshPrefetch();
      }
    },

    togglePlay() {
      const playback = store.playback.peek();
      if (playback.status === "playing") {
        api.pause();
      } else if (playback.status === "paused") {
        api.resume();
      } else if (playback.currentId !== null) {
        void api.play(playback.currentId);
      }
    },

    stop() {
      generation++;
      loaded = null;
      applied = false;
      switching = false;
      timed = null;
      plan = null;
      skipped.clear();
      stopTick();
      clearAwait();
      clearVideo();
      clearPrefetch();
      if (img) {
        img.removeAttribute("src");
        img.hidden = true;
      }
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => undefined);
      }
      currentTime.value = 0;
      duration.value = 0;
      buffered.value = 0;
      resolvedQualityLabel.value = null;
      setLastError(null, false);
      store.updatePlayback({
        status: "idle",
        currentId: null,
        awaitingMore: false,
        consecutiveErrors: 0,
      });
    },

    next() {
      if (store.playback.peek().currentId === null) {
        return;
      }
      userAction();
      advance("user");
    },

    prev() {
      const playback = store.playback.peek();
      if (playback.currentId === null) {
        return;
      }
      userAction();
      const decision = decidePrevSkipping(
        {
          ids: idsOfVisible(),
          currentId: playback.currentId,
          loop: playback.loop,
          shuffle: playback.shuffle,
          playedIds: playback.playedIds,
          currentTime: loaded ? currentPosition() : 0,
        },
        isPlayableId,
      );
      if (decision.type === "play") {
        const item = findVisible(decision.id);
        if (item) {
          plan = null;
          startItem(item);
        }
        return;
      }
      if (decision.type === "none") {
        // Neither an earlier item nor the current one can be played.
        const current = store.currentItem.peek();
        if (current === null || !isPlayableItem(current)) {
          generation++;
          stopNothingPlayable();
        }
        return;
      }
      if (loaded && playback.status !== "idle" && !playback.awaitingMore) {
        api.seek(0);
      } else {
        const item = findVisible(playback.currentId) ?? store.currentItem.peek();
        if (item) {
          startItem(item);
        }
      }
    },

    seek(seconds) {
      if (!loaded || !Number.isFinite(seconds)) {
        return;
      }
      if (timed) {
        const target = Math.min(timed.duration, Math.max(0, seconds));
        timed.elapsed = target;
        if (timed.runningSince !== null) {
          timed.runningSince = performance.now();
        }
        currentTime.value = target;
        return;
      }
      if (!video) {
        loaded.startAt = Math.max(0, seconds);
        return;
      }
      const max = Number.isFinite(video.duration) ? video.duration : duration.peek();
      const target = Math.max(0, max > 0 ? Math.min(max, seconds) : seconds);
      video.currentTime = target;
      currentTime.value = target;
    },

    seekBy(delta) {
      api.seek(currentPosition() + delta);
    },

    setVolume(volume) {
      const rounded = roundVolume(volume);
      const patch: { volume: number; muted?: boolean } = { volume: rounded };
      if (rounded > 0 && store.playback.peek().muted) {
        patch.muted = false;
      }
      store.updatePlayback(patch);
    },

    toggleMute() {
      store.updatePlayback({ muted: !store.playback.peek().muted });
    },

    setSpeed(speed) {
      store.updatePlayback({ speed: normalizeSpeed(speed) });
    },

    cycleLoop() {
      store.updatePlayback({ loop: nextLoopMode(store.playback.peek().loop) });
    },

    toggleShuffle() {
      skipped.clear();
      store.updatePlayback({ shuffle: !store.playback.peek().shuffle });
    },

    setQuality(quality) {
      if (sameQuality(store.playback.peek().quality, quality)) {
        return;
      }
      if (!loaded || !isVideoKind() || !video || !applied) {
        store.updatePlayback({ quality });
        return;
      }
      const { status: playStatus, awaitingMore } = store.playback.peek();
      const startAt = video.currentTime;
      generation++;
      // The prefetch is re-planned with the new quality once the reloaded video plays.
      clearSpare();
      store.updatePlayback({ quality });
      loaded = {
        item: loaded.item,
        startAt,
        autoplay: playStatus === "playing" && !awaitingMore,
      };
      apply();
    },

    async toggleFullscreen(target) {
      try {
        if (fullscreen.peek() && document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          fullscreenTarget = target;
          await target.requestFullscreen();
        }
      } catch (error) {
        console.warn("x-auto-playlist: fullscreen toggle failed", error);
      }
    },

    isFullscreen() {
      return fullscreen.peek();
    },

    async togglePictureInPicture() {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (video && isVideoKind() && document.pictureInPictureEnabled) {
          await video.requestPictureInPicture();
        }
      } catch (error) {
        console.warn("x-auto-playlist: picture-in-picture toggle failed", error);
      }
    },
  };

  return api;
}
