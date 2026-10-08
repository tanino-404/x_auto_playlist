// Pure playback helpers (docs/architecture.md §6.2 / §7.2). Dependency-free for unit tests.

import { SPEED_OPTIONS, VOLUME_STEP } from "@/shared/constants";
import type { LoopMode, MediaSource, PlaylistItem, Quality } from "@/shared/types";

/** prev() restarts the current item instead of going back once this many seconds have played. */
export const PREV_RESTART_THRESHOLD_SECONDS = 3;

export interface NextInput {
  /** Ids of the visible playlist, in order. */
  ids: readonly string[];
  currentId: string | null;
  loop: LoopMode;
  shuffle: boolean;
  playedIds: readonly string[];
  /** 0 <= random() < 1. Injected for tests. */
  random: () => number;
  /**
   * "auto": the item finished on its own (ended / image timer), so loop "one" repeats it.
   * "user": the next button / an error skip — always moves on (loop "one" behaves like "all").
   */
  reason: "auto" | "user";
}

export interface NextDecision {
  /** Item to play next, or null when playback should stop (end of the list). */
  id: string | null;
  /** True when the shuffle pool was exhausted and playedIds must be emptied. */
  resetPlayed: boolean;
}

function pick<T>(values: readonly T[], random: () => number): T | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const index = Math.min(values.length - 1, Math.floor(random() * values.length));
  return values[index];
}

/**
 * Decides the next item (§6.2): loop "one" → same item; shuffle → random unplayed item
 * (all played → reset and redraw, except loop "off" which stops); loop "all" → wraps;
 * loop "off" → null at the end. When the current item is no longer in the list (SPA
 * navigation, mode switch) there is no "next" → null.
 */
export function decideNext(input: NextInput): NextDecision {
  const { ids, currentId, loop, shuffle, playedIds, random, reason } = input;
  if (ids.length === 0) {
    return { id: null, resetPlayed: false };
  }
  if (currentId === null) {
    return { id: ids[0] ?? null, resetPlayed: false };
  }
  const index = ids.indexOf(currentId);
  if (index === -1) {
    return { id: null, resetPlayed: false };
  }
  if (loop === "one" && reason === "auto") {
    return { id: currentId, resetPlayed: false };
  }
  if (shuffle) {
    const played = new Set(playedIds);
    played.add(currentId);
    const unplayed = ids.filter((id) => !played.has(id));
    const chosen = pick(unplayed, random);
    if (chosen !== undefined) {
      return { id: chosen, resetPlayed: false };
    }
    if (loop === "off") {
      return { id: null, resetPlayed: false };
    }
    // Everything has been played: start a new round, avoiding an immediate repeat.
    const others = ids.length > 1 ? ids.filter((id) => id !== currentId) : ids;
    return { id: pick(others, random) ?? null, resetPlayed: true };
  }
  if (index < ids.length - 1) {
    return { id: ids[index + 1] ?? null, resetPlayed: false };
  }
  return loop === "off"
    ? { id: null, resetPlayed: false }
    : { id: ids[0] ?? null, resetPlayed: false };
}

export interface PrevInput {
  ids: readonly string[];
  currentId: string | null;
  loop: LoopMode;
  shuffle: boolean;
  playedIds: readonly string[];
  /** Seconds played of the current item. */
  currentTime: number;
}

export type PrevDecision = { type: "restart" } | { type: "play"; id: string } | { type: "none" };

/**
 * prev(): 3 s or more into the item → restart it. Otherwise the previous item: in shuffle
 * the one played before it (history), else the previous index (wrapping with loop "all" /
 * "one", restarting the first item with loop "off").
 */
export function decidePrev(input: PrevInput): PrevDecision {
  const { ids, currentId, loop, shuffle, playedIds, currentTime } = input;
  if (currentId === null) {
    return ids[0] === undefined ? { type: "none" } : { type: "play", id: ids[0] };
  }
  if (currentTime >= PREV_RESTART_THRESHOLD_SECONDS) {
    return { type: "restart" };
  }
  const index = ids.indexOf(currentId);
  if (index === -1) {
    return { type: "restart" };
  }
  if (shuffle) {
    const historyIndex = playedIds.lastIndexOf(currentId);
    for (let i = historyIndex - 1; i >= 0; i--) {
      const id = playedIds[i];
      if (id !== undefined && ids.includes(id)) {
        return { type: "play", id };
      }
    }
    return { type: "restart" };
  }
  if (index > 0) {
    return { type: "play", id: ids[index - 1] as string };
  }
  if (loop === "off" || ids.length === 1) {
    return { type: "restart" };
  }
  return { type: "play", id: ids[ids.length - 1] as string };
}

const RESOLUTION_IN_URL = /\/(\d+)x(\d+)\//;

/** Width × height of a source: its own fields, else the "/<w>x<h>/" segment of the URL. */
export function sourceResolution(source: MediaSource): { width: number; height: number } | null {
  if (source.width !== undefined && source.height !== undefined) {
    return { width: source.width, height: source.height };
  }
  const match = RESOLUTION_IN_URL.exec(source.url);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

/**
 * The "p" resolution of a source: the shorter side (720x1280 portrait → 720), so portrait
 * videos read the same as landscape ones. A lone `height` field counts when the width is
 * unknown. Null without any resolution info.
 */
export function sourceHeight(source: MediaSource): number | null {
  const resolution = sourceResolution(source);
  if (resolution !== null) {
    return Math.min(resolution.width, resolution.height);
  }
  return source.height !== undefined && source.height > 0 ? source.height : null;
}

/** "720p" style label (the shorter side, so portrait videos read the same). */
export function qualityLabel(source: MediaSource): string | null {
  const height = sourceHeight(source);
  return height === null ? null : `${height}p`;
}

/** Distinct resolutions ("p", see sourceHeight) of the mp4 sources, highest first. */
export function listResolutions(sources: readonly MediaSource[]): number[] {
  const heights = new Set<number>();
  for (const source of sources) {
    if (source.mime !== "video/mp4") {
      continue;
    }
    const height = sourceHeight(source);
    if (height !== null) {
      heights.add(height);
    }
  }
  return [...heights].sort((a, b) => b - a);
}

/** Structural equality of two Quality values ({ height } compares by height). */
export function sameQuality(a: Quality, b: Quality): boolean {
  if (typeof a === "string" || typeof b === "string") {
    return a === b;
  }
  return a.height === b.height;
}

/**
 * The source whose resolution (sourceHeight) equals `target`, else the nearest one (the
 * higher on a tie). `sorted` is ordered best-first, so equal resolutions keep the higher
 * bitrate. Null when no source has resolution info.
 */
function nearestHeight(sorted: readonly MediaSource[], target: number): MediaSource | null {
  let best: MediaSource | null = null;
  let bestHeight = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const source of sorted) {
    const height = sourceHeight(source);
    if (height === null) {
      continue;
    }
    const distance = Math.abs(height - target);
    if (distance < bestDistance || (distance === bestDistance && height > bestHeight)) {
      best = source;
      bestHeight = height;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Picks the mp4 to play. { height } picks that resolution (the shorter side), else the
 * nearest one (the higher on a tie). highest / lowest go by bitrate (then width). auto picks the
 * smallest source whose width is at least `targetWidth` (the caller passes the video area
 * width × devicePixelRatio); when none is that wide, the widest one. Without any resolution
 * info or a target width it falls back to the highest. Equal widths keep the higher bitrate.
 */
export function selectSource(
  sources: readonly MediaSource[],
  quality: Quality,
  targetWidth: number | null,
): MediaSource | null {
  const mp4 = sources.filter((source) => source.mime === "video/mp4");
  if (mp4.length === 0) {
    return null;
  }
  const score = (source: MediaSource) =>
    (source.bitrate ?? 0) * 1e6 + (sourceResolution(source)?.width ?? 0);
  const sorted = [...mp4].sort((a, b) => score(b) - score(a));
  const highest = sorted[0] ?? null;
  if (quality === "highest") {
    return highest;
  }
  if (quality === "lowest") {
    return sorted[sorted.length - 1] ?? null;
  }
  if (typeof quality === "object") {
    return nearestHeight(sorted, quality.height) ?? highest;
  }
  if (targetWidth === null || targetWidth <= 0) {
    return highest;
  }
  let fit: MediaSource | null = null;
  let fitWidth = Number.POSITIVE_INFINITY;
  let widest: MediaSource | null = null;
  let widestWidth = -1;
  for (const source of sorted) {
    const width = sourceResolution(source)?.width;
    if (width === undefined) {
      continue;
    }
    if (width >= targetWidth && width < fitWidth) {
      fit = source;
      fitWidth = width;
    }
    if (width > widestWidth) {
      widest = source;
      widestWidth = width;
    }
  }
  return fit ?? widest ?? highest;
}

/** "m:ss", or "h:mm:ss" from one hour. Invalid / negative values read "0:00". */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Clamps to 0..1 and rounds to VOLUME_STEP (5%) steps. */
export function roundVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, volume));
  const steps = Math.round(clamped / VOLUME_STEP);
  // Avoid 0.15000000000000002-style values.
  return Math.min(1, Math.round(steps * VOLUME_STEP * 100) / 100);
}

/** "50%" */
export function formatVolume(volume: number): string {
  return `${Math.round(roundVolume(volume) * 100)}%`;
}

/** Nearest entry of SPEED_OPTIONS. */
export function normalizeSpeed(speed: number): number {
  let best: number = SPEED_OPTIONS[0];
  for (const option of SPEED_OPTIONS) {
    if (Math.abs(option - speed) < Math.abs(best - speed)) {
      best = option;
    }
  }
  return best;
}

/** "1.0x", "0.75x", "2.0x" */
export function formatSpeed(speed: number): string {
  return `${Number.isInteger(speed * 10) ? speed.toFixed(1) : String(speed)}x`;
}

const LOOP_ORDER: readonly LoopMode[] = ["all", "one", "off"];

/** all → one → off → all */
export function nextLoopMode(loop: LoopMode): LoopMode {
  const index = LOOP_ORDER.indexOf(loop);
  return LOOP_ORDER[(index + 1) % LOOP_ORDER.length] ?? "all";
}

/** Items shown for a fixed time (S-04) instead of until the media ends. */
export function isTimedKind(item: Pick<PlaylistItem, "kind">): boolean {
  return item.kind === "photo" || item.kind === "gif";
}

/** The image URL of a photo item (first image source, else the thumbnail). */
export function photoUrl(item: PlaylistItem): string | null {
  const image = item.sources.find((source) => source.mime.startsWith("image/"));
  return image?.url ?? (item.thumbnailUrl || null);
}

/** End (seconds) of the buffered range containing `time`, else of the last range. */
export function bufferedEnd(
  ranges: { length: number; start(i: number): number; end(i: number): number },
  time: number,
): number {
  let last = 0;
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (time >= start && time <= end) {
      return end;
    }
    last = end;
  }
  return last;
}
