// Pure playlist helpers for src/lib/store/index.ts. Dependency-free so they are easy to unit test.

import type {
  AutoPlaylist,
  ManualPlaylist,
  PlaylistItem,
  PlaylistMode,
  PostFlags,
  Quality,
} from "@/shared/types";

/** docs/architecture.md §5. Kept here because src/shared/types.ts does not define it. */
export interface PlaylistState {
  mode: PlaylistMode;
  auto: AutoPlaylist;
  manual: ManualPlaylist;
}

export type AddPosition = "end" | "next";

export function createInitialPlaylist(mode: PlaylistMode): PlaylistState {
  return {
    mode,
    auto: { pageKey: "", items: [] },
    manual: { items: [], lastPlayedId: null },
  };
}

/** Items shown in the panel for the given mode. */
export function selectVisibleItems(playlist: PlaylistState, mode: PlaylistMode): PlaylistItem[] {
  return mode === "auto" ? playlist.auto.items : playlist.manual.items;
}

/**
 * Removes items whose id already exists in `existing`, and duplicates inside `incoming`
 * itself (first occurrence wins).
 */
export function dedupeItems(existing: PlaylistItem[], incoming: PlaylistItem[]): PlaylistItem[] {
  const seen = new Set(existing.map((item) => item.id));
  const result: PlaylistItem[] = [];
  for (const item of incoming) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

/**
 * Index at which new items are inserted. "next" means right after `currentId`;
 * when `currentId` is null or not in the list, falls back to the end.
 */
export function insertionIndex(
  items: PlaylistItem[],
  position: AddPosition,
  currentId: string | null,
): number {
  if (position === "next" && currentId !== null) {
    const index = items.findIndex((item) => item.id === currentId);
    if (index !== -1) {
      return index + 1;
    }
  }
  return items.length;
}

/** Returns a new list with `incoming` inserted (deduped when `dedupe` is true). */
export function insertItems(
  items: PlaylistItem[],
  incoming: PlaylistItem[],
  options: { position: AddPosition; currentId: string | null; dedupe: boolean },
): PlaylistItem[] {
  const toAdd = options.dedupe ? dedupeItems(items, incoming) : incoming;
  if (toAdd.length === 0) {
    return items;
  }
  const index = insertionIndex(items, options.position, options.currentId);
  return [...items.slice(0, index), ...toAdd, ...items.slice(index)];
}

/**
 * Picks the source to play for a video/gif: mp4 only (HLS is not played directly),
 * ordered by bitrate. "auto" is treated as "highest" in stage 1 (display-size matching
 * comes with quality switching in stage 5).
 */
export function pickVideoSource(item: PlaylistItem, quality: Quality): string | null {
  const mp4 = item.sources.filter((source) => source.mime === "video/mp4");
  if (mp4.length === 0) {
    return null;
  }
  const sorted = [...mp4].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const chosen = quality === "lowest" ? sorted[sorted.length - 1] : sorted[0];
  return chosen?.url ?? null;
}

/**
 * Anchor for "next" inserts into the manual list: the playing item when it is in that list,
 * else manual.lastPlayedId (the item the play button resumes from, F-52), else none (→ end).
 * This keeps "次に再生" meaningful while auto mode is playing an auto item.
 */
export function manualInsertAnchor(
  manual: ManualPlaylist,
  currentId: string | null,
): string | null {
  if (currentId !== null && manual.items.some((item) => item.id === currentId)) {
    return currentId;
  }
  return manual.lastPlayedId;
}

/** Removes `id` from the manual list; clears lastPlayedId when it pointed at the removed item. */
export function removeFromManual(manual: ManualPlaylist, id: string): ManualPlaylist {
  const items = manual.items.filter((item) => item.id !== id);
  if (items.length === manual.items.length) {
    return manual;
  }
  return { items, lastPlayedId: manual.lastPlayedId === id ? null : manual.lastPlayedId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const MEDIA_KINDS: readonly string[] = ["video", "gif", "photo"];

function isMediaSource(value: unknown): boolean {
  return isRecord(value) && typeof value.url === "string" && typeof value.mime === "string";
}

function isAuthor(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.screenName === "string" &&
    typeof value.avatarUrl === "string"
  );
}

/** Structural check of a PlaylistItem restored from storage. */
export function isPlaylistItem(value: unknown): value is PlaylistItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    MEDIA_KINDS.includes(value.kind) &&
    typeof value.postId === "string" &&
    typeof value.postUrl === "string" &&
    isAuthor(value.author) &&
    typeof value.text === "string" &&
    typeof value.thumbnailUrl === "string" &&
    (value.durationMs === undefined || typeof value.durationMs === "number") &&
    Array.isArray(value.sources) &&
    value.sources.every(isMediaSource) &&
    typeof value.playable === "boolean" &&
    typeof value.addedAt === "number"
  );
}

/**
 * Validates a value read from chrome.storage.session ("manualPlaylist"). Anything that
 * does not look like a ManualPlaylist yields an empty one; malformed items are dropped, and
 * lastPlayedId is cleared when it no longer points at a kept item.
 */
export function parseManualPlaylist(saved: unknown): ManualPlaylist {
  if (!isRecord(saved) || !Array.isArray(saved.items)) {
    return { items: [], lastPlayedId: null };
  }
  const items = saved.items.filter(isPlaylistItem);
  const lastPlayedId =
    typeof saved.lastPlayedId === "string" && items.some((item) => item.id === saved.lastPlayedId)
      ? saved.lastPlayedId
      : null;
  return { items, lastPlayedId };
}

/**
 * Returns a copy of `list` with the element at `from` moved so that it ends up at index `to`
 * (both are indices into the original / resulting list). Out-of-range or equal indices return
 * `list` itself (same reference) so callers can skip a write.
 */
export function moveIndex<T>(list: readonly T[], from: number, to: number): readonly T[] {
  const n = list.length;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= n ||
    to < 0 ||
    to >= n ||
    from === to
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * Converts a drop "gap" (0..length: insert before the row at that index, `length` = after the
 * last row) into the `to` index expected by moveIndex().
 */
export function gapToIndex(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

/**
 * Moves `id` to right after `anchorId` ("次に再生" inside the manual list). A null or missing
 * anchor moves it to the front. Returns `items` itself when nothing changes.
 */
export function moveAfter(
  items: PlaylistItem[],
  id: string,
  anchorId: string | null,
): PlaylistItem[] {
  const from = items.findIndex((item) => item.id === id);
  if (from === -1 || id === anchorId) {
    return items;
  }
  const anchor = anchorId === null ? -1 : items.findIndex((item) => item.id === anchorId);
  const gap = anchor + 1;
  return moveIndex(items, from, gapToIndex(from, gap)) as PlaylistItem[];
}

/**
 * S-18 "remove" (F-26): ids of `items` that were played and are not the one playing now.
 * Returned in list order.
 */
export function playedIdsToRemove(
  items: readonly PlaylistItem[],
  playedIds: readonly string[],
  currentId: string | null,
): string[] {
  if (playedIds.length === 0) {
    return [];
  }
  const played = new Set(playedIds);
  return items.filter((item) => item.id !== currentId && played.has(item.id)).map((i) => i.id);
}

/** removeFromManual() for several ids at once. */
export function removeManyFromManual(
  manual: ManualPlaylist,
  ids: readonly string[],
): ManualPlaylist {
  if (ids.length === 0) {
    return manual;
  }
  const drop = new Set(ids);
  const items = manual.items.filter((item) => !drop.has(item.id));
  if (items.length === manual.items.length) {
    return manual;
  }
  const lastPlayedId =
    manual.lastPlayedId !== null && drop.has(manual.lastPlayedId) ? null : manual.lastPlayedId;
  return { items, lastPlayedId };
}

const NO_FLAGS: PostFlags = { favorited: false, bookmarked: false, retweeted: false };

/**
 * F-4C: applies `patch` to the `post` flags of every item whose postId matches. Items without
 * known flags start from all-false. Returns the same array when nothing matched.
 */
export function applyPostFlags(
  items: PlaylistItem[],
  postId: string,
  patch: Partial<PostFlags>,
): PlaylistItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.postId !== postId) {
      return item;
    }
    changed = true;
    return { ...item, post: { ...NO_FLAGS, ...item.post, ...patch } };
  });
  return changed ? next : items;
}
