import { describe, expect, it } from "vitest";
import { countRemaining, decideScroll, type ScrollInput } from "@/lib/scroller/logic";
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
    for (const pageKind of ["home", "bookmarks", "likes", "user-media", "search"] as const) {
      expect(decideScroll(input({ pageKind })).action).toBe("scroll");
    }
  });

  it("waits for the threshold: 4 remaining -> none, 3 -> scroll", () => {
    expect(decideScroll(input({ remaining: 4 }))).toMatchObject({
      action: "none",
      reason: "enough-items",
    });
    expect(decideScroll(input({ remaining: 3 }))).toMatchObject({ action: "scroll" });
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
    expect(decideScroll(input({ lastScrollAt: NOW - 4000 }))).toEqual({
      action: "wait",
      waitMs: SCROLL.intervalMs.slow - 4000,
      reason: "interval",
    });
    expect(
      decideScroll(input({ lastScrollAt: NOW - 4000, intervalMs: SCROLL.intervalMs.normal })),
    ).toEqual({ action: "wait", waitMs: 1000, reason: "interval" });
    expect(decideScroll(input({ lastScrollAt: NOW - SCROLL.intervalMs.slow })).action).toBe(
      "scroll",
    );
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
