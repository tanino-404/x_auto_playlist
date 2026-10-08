import { describe, expect, it } from "vitest";
import { INITIAL_RATE_LIMIT, nextRateLimit } from "@/lib/store/collector-state";
import { SCROLL } from "@/shared/constants";

const NOW = 1_790_000_000_000;

describe("nextRateLimit", () => {
  it("records the headers of a normal response", () => {
    expect(
      nextRateLimit(INITIAL_RATE_LIMIT, { remaining: 40, reset: 1_790_000_900 }, 200, NOW),
    ).toEqual({ remaining: 40, reset: 1_790_000_900, limitedUntil: null });
  });

  it("429 → limitedUntil = reset (in ms)", () => {
    const next = nextRateLimit(
      INITIAL_RATE_LIMIT,
      { remaining: 0, reset: 1_790_000_300 },
      429,
      NOW,
    );
    expect(next.limitedUntil).toBe(1_790_000_300_000);
  });

  it("429 without (or with a past) reset → now + fallback wait", () => {
    expect(
      nextRateLimit(INITIAL_RATE_LIMIT, { remaining: null, reset: null }, 429, NOW).limitedUntil,
    ).toBe(NOW + SCROLL.rateLimitFallbackWaitMs);
    expect(
      nextRateLimit(INITIAL_RATE_LIMIT, { remaining: 0, reset: 1_000 }, 429, NOW).limitedUntil,
    ).toBe(NOW + SCROLL.rateLimitFallbackWaitMs);
  });

  it("a successful response clears the limit", () => {
    const limited = { remaining: 0, reset: 1_790_000_300, limitedUntil: NOW + 5000 };
    expect(
      nextRateLimit(limited, { remaining: 10, reset: null }, 200, NOW).limitedUntil,
    ).toBeNull();
  });

  it("another error keeps a pending limit, drops an expired one", () => {
    const limited = { remaining: 0, reset: null, limitedUntil: NOW + 5000 };
    expect(nextRateLimit(limited, { remaining: null, reset: null }, 500, NOW).limitedUntil).toBe(
      NOW + 5000,
    );
    expect(
      nextRateLimit(limited, { remaining: null, reset: null }, 500, NOW + 6000).limitedUntil,
    ).toBeNull();
  });
});
