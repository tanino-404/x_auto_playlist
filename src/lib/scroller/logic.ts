// Pure auto-scroll decision (docs/architecture.md §6.6). Dependency-free for unit tests.

import type { RateLimitState } from "@/lib/store/collector-state";
import { SCROLL } from "@/shared/constants";
import type { PageKind, PlaybackStatus, PlaylistMode, ScrollPace } from "@/shared/types";

/** Pages whose timeline the collector turns into the auto playlist. */
export const SCROLLABLE_PAGES: readonly PageKind[] = [
  "home",
  "bookmarks",
  "likes",
  "user-media",
  "user-posts",
  "user-replies",
  "user-reposts",
  "search",
];

/** Consecutive scrolls at the bottom of the page without new items before giving up. */
export const BOTTOM_STREAK_LIMIT = 3;

/** The playing media counts as "about to end" below this many seconds left (F-65). */
export const MEDIA_ENDING_SEC = 15;
/** While the media is about to end, scroll right away when this few items (or fewer) remain. */
export const URGENT_REMAINING_MAX = 2;

/** Pixels one scroll step moves for the given pace (F-65). */
export function scrollStepPx(pace: ScrollPace, viewportHeight: number): number {
  return Math.round(viewportHeight * SCROLL.stepViewports[pace]);
}

/** Seconds left in the playing media, or null when the duration is unknown. */
export function mediaRemainingSec(currentTime: number, duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return Math.max(0, duration - currentTime);
}

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
  /**
   * Epoch ms when the playing media fell under MEDIA_ENDING_SEC left (reset per item), or
   * null while it is not about to end / unknown.
   */
  mediaEndingSince?: number | null;
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
  | "media-ending"
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

  // F-65: the media is about to end with almost nothing queued -> scroll once right away
  // without waiting for the interval (once per "ending" phase; then the interval applies).
  const endingSince = input.mediaEndingSince ?? null;
  const urgent =
    !input.awaitingMore &&
    input.remaining <= URGENT_REMAINING_MAX &&
    endingSince !== null &&
    (input.lastScrollAt === null || input.lastScrollAt < endingSince);
  const gap = urgent ? 0 : input.intervalMs;

  // The interval is the only thing between two scrolls: whether the previous scroll brought
  // new items or not, scroll again once it has passed (X loads only after enough scrolling).
  if (input.lastScrollAt !== null) {
    const elapsed = now - input.lastScrollAt;
    if (elapsed < gap) {
      return { action: "wait", waitMs: gap - elapsed, reason: "interval" };
    }
  }
  if (input.awaitingMore) {
    return { action: "scroll", reason: "awaiting-more" };
  }
  return { action: "scroll", reason: urgent ? "media-ending" : "near-end" };
}
