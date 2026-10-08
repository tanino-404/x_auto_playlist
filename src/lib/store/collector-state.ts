// Pure helpers for the collector-related parts of the store (stage 2). Dependency-free.

import { SCROLL } from "@/shared/constants";
import type { InterceptedResponse } from "@/shared/messages";

export type CollectorStatus = "unknown" | "ok" | "broken";

export interface RateLimitState {
  remaining: number | null;
  /** Unix seconds, as sent by X. */
  reset: number | null;
  /** Epoch milliseconds until which X is rate-limiting us (set on 429), or null. */
  limitedUntil: number | null;
}

export const INITIAL_RATE_LIMIT: RateLimitState = {
  remaining: null,
  reset: null,
  limitedUntil: null,
};

const RATE_LIMITED_STATUS = 429;

/**
 * Next rate-limit state after a response. A 429 sets `limitedUntil` to `reset`
 * (or now + SCROLL.rateLimitFallbackWaitMs when X did not say). Any other response clears it
 * once that time has passed; a still-pending limit is kept.
 */
export function nextRateLimit(
  previous: RateLimitState,
  rateLimit: InterceptedResponse["rateLimit"],
  status: number,
  now: number,
): RateLimitState {
  let limitedUntil: number | null;
  if (status === RATE_LIMITED_STATUS) {
    limitedUntil =
      rateLimit.reset !== null && rateLimit.reset * 1000 > now
        ? rateLimit.reset * 1000
        : now + SCROLL.rateLimitFallbackWaitMs;
  } else if (status >= 200 && status < 300) {
    limitedUntil = null;
  } else {
    limitedUntil =
      previous.limitedUntil !== null && previous.limitedUntil > now ? previous.limitedUntil : null;
  }
  return {
    remaining: rateLimit.remaining,
    reset: rateLimit.reset,
    limitedUntil,
  };
}
