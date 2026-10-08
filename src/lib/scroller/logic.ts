// Pure auto-scroll decision (docs/architecture.md §6.6). Dependency-free for unit tests.

import type { RateLimitState } from "@/lib/store/collector-state";
import { SCROLL } from "@/shared/constants";
import type { PageKind, PlaybackStatus, PlaylistMode } from "@/shared/types";

/** Pages whose timeline the collector turns into the auto playlist. */
export const SCROLLABLE_PAGES: readonly PageKind[] = [
  "home",
  "bookmarks",
  "likes",
  "user-media",
  "search",
];

/** Consecutive scrolls at the bottom of the page without new items before giving up. */
export const BOTTOM_STREAK_LIMIT = 3;

export interface ScrollInput {
  autoScroll: boolean;
  mode: PlaylistMode;
  status: PlaybackStatus;
  pageKind: PageKind;
  /** Items still to play after the current one (see countRemaining). */
  remaining: number;
  awaitingMore: boolean;
  /** Epoch ms when awaitingMore became true, or null. */
  awaitingSince: number | null;
  now: number;
  /** Epoch ms of the last scroll, or null. */
  lastScrollAt: number | null;
  intervalMs: number;
  rateLimit: RateLimitState;
  /** Epoch ms when `rateLimit` was last updated (base for the fallback wait), or null. */
  rateLimitSeenAt: number | null;
  /** Scrolls done at the page bottom in a row without the list growing. */
  bottomStreak: number;
}

export type ScrollReason =
  | "auto-scroll-off"
  | "not-auto-mode"
  | "not-playing"
  | "page-not-collected"
  | "load-timeout"
  | "enough-items"
  | "end-of-page"
  | "rate-limited"
  | "rate-limit-low"
  | "interval"
  | "near-end"
  | "awaiting-more";

export interface ScrollDecision {
  action: "scroll" | "wait" | "none";
  /** For "wait": milliseconds until the decision should be re-evaluated. */
  waitMs?: number;
  reason: ScrollReason;
}

/**
 * Items left to play after `currentId`. With shuffle, the unplayed items other than the
 * current one. When the current item is not in the list, every item counts as remaining.
 */
export function countRemaining(
  ids: readonly string[],
  currentId: string | null,
  shuffle: boolean,
  playedIds: readonly string[],
): number {
  if (shuffle) {
    const played = new Set(playedIds);
    return ids.filter((id) => id !== currentId && !played.has(id)).length;
  }
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  return index === -1 ? ids.length : ids.length - index - 1;
}

export function decideScroll(input: ScrollInput): ScrollDecision {
  const { now } = input;
  if (!input.autoScroll) {
    return { action: "none", reason: "auto-scroll-off" };
  }
  if (input.mode !== "auto") {
    return { action: "none", reason: "not-auto-mode" };
  }
  // F-02: never scroll unless playing.
  if (input.status !== "playing") {
    return { action: "none", reason: "not-playing" };
  }
  if (!SCROLLABLE_PAGES.includes(input.pageKind)) {
    return { action: "none", reason: "page-not-collected" };
  }
  if (
    input.awaitingMore &&
    input.awaitingSince !== null &&
    now - input.awaitingSince >= SCROLL.loadTimeoutMs
  ) {
    return { action: "none", reason: "load-timeout" };
  }
  if (!input.awaitingMore && input.remaining > SCROLL.remainingThreshold) {
    return { action: "none", reason: "enough-items" };
  }
  if (input.bottomStreak >= BOTTOM_STREAK_LIMIT) {
    return { action: "none", reason: "end-of-page" };
  }

  const { limitedUntil, remaining, reset } = input.rateLimit;
  if (limitedUntil !== null && limitedUntil > now) {
    return { action: "wait", waitMs: limitedUntil - now, reason: "rate-limited" };
  }
  if (remaining !== null && remaining < SCROLL.rateLimitRemainingFloor) {
    const until =
      reset !== null
        ? reset * 1000
        : (input.rateLimitSeenAt ?? now) + SCROLL.rateLimitFallbackWaitMs;
    if (until > now) {
      return { action: "wait", waitMs: until - now, reason: "rate-limit-low" };
    }
  }

  if (input.lastScrollAt !== null) {
    const elapsed = now - input.lastScrollAt;
    if (elapsed < input.intervalMs) {
      return { action: "wait", waitMs: input.intervalMs - elapsed, reason: "interval" };
    }
  }
  return { action: "scroll", reason: input.awaitingMore ? "awaiting-more" : "near-end" };
}
