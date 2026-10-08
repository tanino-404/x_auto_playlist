import { describe, expect, it } from "vitest";
import {
  countRemaining,
  decideScroll,
  MEDIA_ENDING_SEC,
  mediaRemainingSec,
  type ScrollInput,
  scrollStepPx,
} from "@/lib/scroller/logic";
import { SCROLL } from "@/shared/constants";

const NOW = 1_700_000_000_000;

function input(patch: Partial<ScrollInput> = {}): ScrollInput {
  return {
    autoScroll: true,
    mode: "auto",
    status: "playing",
    pageKind: "home",
    remaining: 3,
    awaitingMore: false,
    awaitingSince: null,
    now: NOW,
    lastScrollAt: null,
    intervalMs: SCROLL.intervalMs.slow,
    rateLimit: { remaining: null, reset: null, limitedUntil: null },
    rateLimitSeenAt: null,
    bottomStreak: 0,
    ...patch,
  };
}

describe("decideScroll", () => {
  it("does nothing unless playing (F-02)", () => {
    expect(decideScroll(input({ status: "paused" }))).toMatchObject({ action: "none" });
    expect(decideScroll(input({ status: "idle" }))).toMatchObject({ action: "none" });
  });

  it("does nothing in manual mode or with auto-scroll off", () => {
    expect(decideScroll(input({ mode: "manual" }))).toMatchObject({ action: "none" });
    expect(decideScroll(input({ autoScroll: false }))).toMatchObject({
      action: "none",
      reason: "auto-scroll-off",
    });
  });

  it("does nothing on pages that are not collected", () => {
    expect(decideScroll(input({ pageKind: "status" }))).toMatchObject({ action: "none" });
    expect(decideScroll(input({ pageKind: "other" }))).toMatchObject({ action: "none" });
    for (const pageKind of [
      "home",
      "bookmarks",
      "likes",
      "user-media",
      "user-posts",
      "user-replies",
      "user-reposts",
      "search",
    ] as const) {
      expect(decideScroll(input({ pageKind })).action).toBe("scroll");
    }
  });

  it("waits for the threshold: 6 remaining -> none, 5 -> scroll", () => {
    expect(SCROLL.remainingThreshold).toBe(5);
    expect(decideScroll(input({ remaining: 6 }))).toMatchObject({
      action: "none",
      reason: "enough-items",
    });
    expect(decideScroll(input({ remaining: 5 }))).toMatchObject({ action: "scroll" });
    expect(decideScroll(input({ remaining: 0 }))).toMatchObject({ action: "scroll" });
  });

  it("scrolls while awaitingMore even with many items", () => {
    expect(
      decideScroll(input({ remaining: 10, awaitingMore: true, awaitingSince: NOW - 1000 })),
    ).toMatchObject({ action: "scroll", reason: "awaiting-more" });
  });

  it("gives up after the load timeout while awaitingMore", () => {
    expect(
      decideScroll(input({ awaitingMore: true, awaitingSince: NOW - SCROLL.loadTimeoutMs })),
    ).toMatchObject({ action: "none", reason: "load-timeout" });
  });

  it("keeps the interval between scrolls", () => {
    expect(decideScroll(input({ lastScrollAt: NOW - 1000 }))).toEqual({
      action: "wait",
      waitMs: SCROLL.intervalMs.slow - 1000,
      reason: "interval",
    });
    expect(
      decideScroll(input({ lastScrollAt: NOW - 1000, intervalMs: SCROLL.intervalMs.normal })),
    ).toEqual({ action: "wait", waitMs: SCROLL.intervalMs.normal - 1000, reason: "interval" });
    expect(decideScroll(input({ lastScrollAt: NOW - SCROLL.intervalMs.slow })).action).toBe(
      "scroll",
    );
  });

  it("uses the interval of each of the 3 paces", () => {
    for (const pace of ["slow", "normal", "fast"] as const) {
      const intervalMs = SCROLL.intervalMs[pace];
      expect(decideScroll(input({ intervalMs, lastScrollAt: NOW - 100 }))).toEqual({
        action: "wait",
        waitMs: intervalMs - 100,
        reason: "interval",
      });
      expect(decideScroll(input({ intervalMs, lastScrollAt: NOW - intervalMs })).action).toBe(
        "scroll",
      );
    }
    expect(SCROLL.intervalMs.fast).toBeLessThan(SCROLL.intervalMs.normal);
    expect(SCROLL.intervalMs.normal).toBeLessThan(SCROLL.intervalMs.slow);
  });

  it("scrolls again after the interval even when no new items arrived", () => {
    // Nothing in the input says "a response came"; only the interval gates the next scroll.
    const intervalMs = SCROLL.intervalMs.normal;
    expect(decideScroll(input({ intervalMs, lastScrollAt: NOW - intervalMs }))).toEqual({
      action: "scroll",
      reason: "near-end",
    });
    expect(
      decideScroll(
        input({
          intervalMs,
          lastScrollAt: NOW - intervalMs,
          awaitingMore: true,
          awaitingSince: NOW - 10_000,
        }),
      ),
    ).toEqual({ action: "scroll", reason: "awaiting-more" });
  });

  describe("media about to end (short videos)", () => {
    const intervalMs = SCROLL.intervalMs.normal;
    const recent = NOW - 300; // inside the interval

    it("scrolls right away with 1-2 items left, ignoring the interval", () => {
      for (const remaining of [1, 2]) {
        expect(
          decideScroll(
            input({ intervalMs, remaining, lastScrollAt: recent, mediaEndingSince: NOW - 100 }),
          ),
        ).toEqual({ action: "scroll", reason: "media-ending" });
      }
    });

    it("does it only once per ending phase, then the interval applies", () => {
      expect(
        decideScroll(
          input({
            intervalMs,
            remaining: 1,
            lastScrollAt: recent,
            mediaEndingSince: NOW - 1000,
          }),
        ),
      ).toEqual({ action: "wait", waitMs: intervalMs - 300, reason: "interval" });
    });

    it("keeps the interval with 3+ items left or when the media is not ending", () => {
      expect(
        decideScroll(
          input({ intervalMs, remaining: 3, lastScrollAt: recent, mediaEndingSince: NOW - 100 }),
        ).action,
      ).toBe("wait");
      expect(
        decideScroll(
          input({ intervalMs, remaining: 1, lastScrollAt: recent, mediaEndingSince: null }),
        ).action,
      ).toBe("wait");
    });

    it("still waits for X's rate limit", () => {
      expect(
        decideScroll(
          input({
            remaining: 1,
            lastScrollAt: recent,
            mediaEndingSince: NOW - 100,
            rateLimit: { remaining: 0, reset: null, limitedUntil: NOW + 30_000 },
          }),
        ),
      ).toEqual({ action: "wait", waitMs: 30_000, reason: "rate-limited" });
    });
  });

  it("waits until limitedUntil after a 429", () => {
    expect(
      decideScroll(input({ rateLimit: { remaining: 0, reset: null, limitedUntil: NOW + 30_000 } })),
    ).toEqual({ action: "wait", waitMs: 30_000, reason: "rate-limited" });
  });

  it("waits until reset when remaining < 5", () => {
    const reset = Math.floor(NOW / 1000) + 120;
    expect(decideScroll(input({ rateLimit: { remaining: 4, reset, limitedUntil: null } }))).toEqual(
      { action: "wait", waitMs: reset * 1000 - NOW, reason: "rate-limit-low" },
    );
    // remaining == floor is fine.
    expect(
      decideScroll(input({ rateLimit: { remaining: 5, reset, limitedUntil: null } })).action,
    ).toBe("scroll");
  });

  it("waits 60 s from when the low remaining was seen when reset is unknown", () => {
    expect(
      decideScroll(
        input({
          rateLimit: { remaining: 2, reset: null, limitedUntil: null },
          rateLimitSeenAt: NOW - 10_000,
        }),
      ),
    ).toEqual({ action: "wait", waitMs: 50_000, reason: "rate-limit-low" });
    expect(
      decideScroll(
        input({
          rateLimit: { remaining: 2, reset: null, limitedUntil: null },
          rateLimitSeenAt: NOW - 60_000,
        }),
      ).action,
    ).toBe("scroll");
  });

  it("scrolls again once the reset time has passed", () => {
    const reset = Math.floor(NOW / 1000) - 1;
    expect(
      decideScroll(input({ rateLimit: { remaining: 0, reset, limitedUntil: null } })).action,
    ).toBe("scroll");
  });

  it("stops after 3 bottom-of-page scrolls without new items", () => {
    expect(decideScroll(input({ bottomStreak: 3 }))).toMatchObject({
      action: "none",
      reason: "end-of-page",
    });
    expect(decideScroll(input({ bottomStreak: 2 })).action).toBe("scroll");
  });
});

describe("scrollStepPx", () => {
  it("scrolls more per step at faster paces", () => {
    expect(scrollStepPx("slow", 800)).toBe(800);
    expect(scrollStepPx("normal", 800)).toBe(1200);
    expect(scrollStepPx("fast", 800)).toBe(2000);
  });
});

describe("mediaRemainingSec", () => {
  it("is null for an unknown duration", () => {
    expect(mediaRemainingSec(0, 0)).toBeNull();
    expect(mediaRemainingSec(0, Number.NaN)).toBeNull();
  });
  it("is duration - currentTime, never negative", () => {
    expect(mediaRemainingSec(10, 30)).toBe(20);
    expect(mediaRemainingSec(31, 30)).toBe(0);
    expect(mediaRemainingSec(16, 30)).toBeLessThan(MEDIA_ENDING_SEC);
  });
});

describe("countRemaining", () => {
  const ids = ["a", "b", "c", "d", "e"];
  it("counts items after the current one", () => {
    expect(countRemaining(ids, "b", false, [])).toBe(3);
    expect(countRemaining(ids, "e", false, [])).toBe(0);
  });
  it("counts everything when nothing / something unknown is current", () => {
    expect(countRemaining(ids, null, false, [])).toBe(5);
    expect(countRemaining(ids, "zz", false, [])).toBe(5);
  });
  it("counts unplayed items when shuffling", () => {
    expect(countRemaining(ids, "c", true, ["a", "c"])).toBe(3);
  });
});
