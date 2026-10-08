// Auto-scroll while playing (docs/architecture.md §6.6, requirements F-02 / S-13).
// Scrolls one viewport at a time so X loads more of the timeline, which the collector then
// turns into auto playlist items. Never scrolls unless playback is "playing" (F-02).
// The decision itself lives in ./logic.ts (pure); this file only wires signals and timers.

import type { ReadonlySignal } from "@preact/signals";
import { effect, signal } from "@preact/signals";
import type { Navigation } from "@/lib/navigation";
import {
  BOTTOM_STREAK_LIMIT,
  countRemaining,
  decideScroll,
  type ScrollDecision,
} from "@/lib/scroller/logic";
import type { Store } from "@/lib/store";
import { SCROLL } from "@/shared/constants";

export type ScrollerState = "idle" | "scrolling" | "waiting-response" | "rate-limited" | "disabled";

export interface Scroller {
  readonly state: ReadonlySignal<ScrollerState>;
  dispose(): void;
}

/** Distance (px) from the bottom under which the page counts as fully scrolled. */
const BOTTOM_EPSILON_PX = 2;
/** A smooth scroll started this recently is interrupted when playback stops. */
const SMOOTH_SCROLL_MS = 1000;

function isAtPageBottom(): boolean {
  const doc = document.documentElement;
  return doc.scrollHeight - (window.scrollY + window.innerHeight) < BOTTOM_EPSILON_PX;
}

export function createScroller(deps: { store: Store; navigation: Navigation }): Scroller {
  const { store, navigation } = deps;
  const state = signal<ScrollerState>("idle");

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastScrollAt: number | null = null;
  /** auto.items.length when we last scrolled; growth past it means "a response arrived". */
  let itemsAtLastScroll = 0;
  let bottomStreak = 0;
  let awaitingSince: number | null = null;
  let rateLimitSeenAt: number | null = null;
  let lastItemsLength = 0;
  let lastPageKey = "";
  let lastRateLimit: unknown = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const stopSmoothScroll = () => {
    if (lastScrollAt !== null && Date.now() - lastScrollAt < SMOOTH_SCROLL_MS) {
      // Scrolling to where we are cancels an in-flight smooth scroll.
      window.scrollTo({ top: window.scrollY, behavior: "instant" });
    }
  };

  const setState = (next: ScrollerState) => {
    if (state.peek() !== next) {
      state.value = next;
    }
  };

  const decide = (): ScrollDecision => {
    const settings = store.settings.peek();
    const playback = store.playback.peek();
    const items = store.visibleItems.peek();
    return decideScroll({
      autoScroll: settings.autoScroll,
      mode: settings.mode,
      status: playback.status,
      pageKind: navigation.current.peek().kind,
      remaining: countRemaining(
        items.map((item) => item.id),
        playback.currentId,
        playback.shuffle,
        playback.playedIds,
      ),
      awaitingMore: playback.awaitingMore,
      awaitingSince,
      now: Date.now(),
      lastScrollAt,
      intervalMs: SCROLL.intervalMs[settings.scrollPace],
      rateLimit: store.rateLimit.peek(),
      rateLimitSeenAt,
      bottomStreak,
    });
  };

  const evaluate = () => {
    clearTimer();
    if (disposed) {
      return;
    }
    const decision = decide();
    switch (decision.action) {
      case "none":
        if (decision.reason === "not-playing") {
          stopSmoothScroll();
        }
        setState(decision.reason === "auto-scroll-off" ? "disabled" : "idle");
        return;
      case "wait": {
        if (decision.reason === "interval") {
          const grown = store.playlist.peek().auto.items.length > itemsAtLastScroll;
          setState(grown ? "scrolling" : "waiting-response");
        } else {
          setState("rate-limited");
        }
        // +50ms so the re-evaluation lands after the deadline, not just before it.
        timer = setTimeout(evaluate, Math.max(0, decision.waitMs ?? 0) + 50);
        return;
      }
      case "scroll": {
        const length = store.playlist.peek().auto.items.length;
        if (lastScrollAt !== null && length <= itemsAtLastScroll && isAtPageBottom()) {
          bottomStreak++;
          if (bottomStreak >= BOTTOM_STREAK_LIMIT) {
            // Nothing more to load; the player handles awaitingMore on its own.
            setState("idle");
            return;
          }
        }
        lastScrollAt = Date.now();
        itemsAtLastScroll = length;
        window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
        setState("scrolling");
        // Re-evaluate right away: this schedules the interval wait ("waiting-response").
        evaluate();
        return;
      }
    }
  };

  const disposeEffect = effect(() => {
    // Subscribe to everything the decision depends on.
    store.settings.value;
    store.visibleItems.value;
    navigation.current.value;
    const playback = store.playback.value;
    const rateLimit = store.rateLimit.value;
    const auto = store.playlist.value.auto;

    const now = Date.now();
    if (rateLimit !== lastRateLimit) {
      // Base for the fallback wait when X did not send a reset time.
      lastRateLimit = rateLimit;
      rateLimitSeenAt = now;
    }
    if (auto.pageKey !== lastPageKey) {
      lastPageKey = auto.pageKey;
      bottomStreak = 0;
      itemsAtLastScroll = 0;
      lastItemsLength = auto.items.length;
    } else if (auto.items.length > lastItemsLength) {
      // A response arrived: back to normal judging.
      bottomStreak = 0;
    }
    lastItemsLength = auto.items.length;

    if (playback.awaitingMore) {
      awaitingSince ??= now;
    } else {
      awaitingSince = null;
    }
    evaluate();
  });

  return {
    state,
    dispose() {
      disposed = true;
      clearTimer();
      disposeEffect();
      setState("idle");
    },
  };
}
