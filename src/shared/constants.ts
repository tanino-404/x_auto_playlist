// Shared file: edited by the PL only.

/** GraphQL operation names the interceptor forwards. Query ids are ignored. */
export const TARGET_OPERATIONS = [
  "HomeTimeline",
  "HomeLatestTimeline",
  "Bookmarks",
  "Likes",
  "UserVideoTimeline",
  "UserPhotoTimeline",
  "UserMedia",
  // Profile tabs (v1.1). Confirmed on the live site 2026-10-08:
  // posts `/<user>` → UserOriginalsTimeline, replies `/<user>/with_replies` → UserRepliesTimeline,
  // reposts `/<user>/reposts` → UserRepostsTimeline (all under data.user.result.timeline.timeline).
  "UserOriginalsTimeline",
  "UserRepliesTimeline",
  "UserRepostsTimeline",
  "UserHighlightsTweets",
  "SearchTimeline",
  "TweetDetail",
] as const;

export type TargetOperation = (typeof TARGET_OPERATIONS)[number];

/**
 * Matches /i/api/graphql/<queryId>/<OperationName>.
 * X sometimes issues a "bundle.<OperationName>" variant of the same query; the optional
 * prefix is skipped so both resolve to the same operation name.
 */
export const GRAPHQL_URL_PATTERN = /\/i\/api\/graphql\/[^/]+\/(?:bundle\.)?([A-Za-z0-9_]+)/;

export const PANEL = {
  defaultWidth: 360,
  minWidth: 300,
  maxWidth: 560,
} as const;

export const PLAYER_WINDOW = {
  defaultWidth: 480,
  aspectRatio: 16 / 9,
  controlsHideDelayMs: 3000,
} as const;

export const VOLUME_STEP = 0.05;

export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Seconds to jump on seek shortcuts / buttons. */
export const SEEK_STEP_SECONDS = 5;

export const HOVER_PREVIEW_SECONDS = 5;

export const POST_CACHE_LIMIT = 2000;

export const SCROLL = {
  /** Trigger auto-scroll when this many items or fewer remain (v1.1: raised from 3). */
  remainingThreshold: 5,
  /** Minimum gap between scroll steps per pace (v1.1: all faster, "fast" added). */
  intervalMs: { slow: 4_000, normal: 2_000, fast: 800 },
  /** How many viewport heights one step scrolls, per pace. */
  stepViewports: { slow: 1, normal: 1.5, fast: 2.5 },
  rateLimitRemainingFloor: 5,
  rateLimitFallbackWaitMs: 60_000,
  loadTimeoutMs: 30_000,
} as const;

export const MAX_CONSECUTIVE_ERRORS = 3;

export const TEXT_PREVIEW_LENGTH = 10;

/** Custom element / shadow host name used by the content UI. */
export const UI_HOST_NAME = "x-auto-playlist";

/** GraphQL mutations used by post actions (F-4C). Query ids are learned at runtime. */
export const POST_ACTION_OPERATIONS = [
  "FavoriteTweet",
  "UnfavoriteTweet",
  "CreateBookmark",
  "DeleteBookmark",
  "CreateRetweet",
  "DeleteRetweet",
] as const;

export type PostActionOperation = (typeof POST_ACTION_OPERATIONS)[number];

/**
 * Bearer token of X's public web client. It is the same for every browser session and has been
 * stable for years; it is not a user secret (the per-user credentials are the cookies).
 */
export const X_WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

/** Where post-action query ids are cached (chrome.storage.session). */
export const QUERY_ID_CACHE_KEY = "postActionQueryIds";
