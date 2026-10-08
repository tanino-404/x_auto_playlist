import { signal } from "@preact/signals";
import { describe, expect, it, vi } from "vitest";
import type { CollectorDeps } from "@/lib/collector/pipeline";
import {
  BROKEN_THRESHOLD,
  createCollectorPipeline,
  shouldAppendToAuto,
} from "@/lib/collector/pipeline";
import type { PageInfo } from "@/lib/navigation";
import { getPageInfo } from "@/lib/navigation";
import { createPostCache } from "@/lib/post-cache";
import type { CollectorStatus } from "@/lib/store";
import type { InterceptedResponse } from "@/shared/messages";
import { INTERCEPT_MESSAGE_TYPE } from "@/shared/messages";
import type { PlaylistItem, Settings } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";
import { loadFixture } from "./fixtures";

function setup(options: { url?: string; settings?: Partial<Settings> } = {}) {
  const added: Array<{ items: PlaylistItem[]; target: string }> = [];
  const statuses: CollectorStatus[] = [];
  const rateLimits: Array<{ rl: InterceptedResponse["rateLimit"]; status: number }> = [];
  const current = signal<PageInfo>(getPageInfo(options.url ?? "https://x.com/home"));
  const postCache = createPostCache();
  const deps: CollectorDeps = {
    store: {
      settings: signal<Settings>({ ...DEFAULT_SETTINGS, ...options.settings }),
      addItems(items, target) {
        added.push({ items, target });
      },
      setRateLimit(rl, status) {
        rateLimits.push({ rl, status });
      },
      setCollectorStatus(status) {
        statuses.push(status);
      },
    },
    postCache,
    navigation: { current },
  };
  return { handle: createCollectorPipeline(deps), added, statuses, rateLimits, postCache, current };
}

function response(
  operation: string,
  body: unknown,
  status = 200,
  rateLimit: InterceptedResponse["rateLimit"] = { remaining: 499, reset: 1_790_000_900 },
): InterceptedResponse {
  return {
    type: INTERCEPT_MESSAGE_TYPE,
    operation,
    url: `https://x.com/i/api/graphql/q/${operation}`,
    status,
    body,
    rateLimit,
    receivedAt: 1_790_000_000_000,
  };
}

const ids = (items: PlaylistItem[]) => items.map((item) => item.id);

describe("createCollectorPipeline", () => {
  it("auto mode on the matching page: caches posts and appends all items", () => {
    const { handle, added, postCache, statuses } = setup();
    handle(response("HomeTimeline", loadFixture("home-timeline.json")));
    expect(added).toHaveLength(1);
    expect(added[0]?.target).toBe("auto");
    expect(added[0]?.items).toHaveLength(12);
    expect(postCache.size()).toBe(10);
    expect(postCache.get("1050")?.items[0]?.id).toBe("7_5001");
    expect(statuses).toEqual(["ok"]);
  });

  it("always reports the rate limit, even for a 429 with no body", () => {
    const { handle, rateLimits, added, statuses } = setup();
    handle(response("HomeTimeline", null, 429, { remaining: 0, reset: 1_790_000_060 }));
    expect(rateLimits).toEqual([{ rl: { remaining: 0, reset: 1_790_000_060 }, status: 429 }]);
    expect(added).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it("page mismatch: caches posts but does not add to the auto playlist", () => {
    const { handle, added, postCache } = setup({ url: "https://x.com/i/bookmarks" });
    handle(response("HomeTimeline", loadFixture("home-timeline.json")));
    expect(added).toEqual([]);
    expect(postCache.size()).toBe(10);
  });

  it("follows page changes", () => {
    const { handle, added, current } = setup({ url: "https://x.com/home" });
    handle(response("Bookmarks", loadFixture("bookmarks.json")));
    expect(added).toEqual([]);
    current.value = getPageInfo("https://x.com/i/bookmarks");
    handle(response("Bookmarks", loadFixture("bookmarks.json")));
    expect(ids(added[0]?.items ?? [])).toEqual(["7_20001"]);
  });

  it("manual mode: caches posts but does not add", () => {
    const { handle, added, postCache } = setup({ settings: { mode: "manual" } });
    handle(response("HomeTimeline", loadFixture("home-timeline.json")));
    expect(added).toEqual([]);
    expect(postCache.size()).toBe(10);
  });

  it("includeImages=false drops photos only", () => {
    const { handle, added } = setup({
      url: "https://x.com/alice/likes",
      settings: { includeImages: false },
    });
    handle(response("Likes", loadFixture("likes.json")));
    expect(ids(added[0]?.items ?? [])).toEqual(["16_30002"]);
  });

  it("does not call addItems when nothing is left to add", () => {
    const { handle, added } = setup({ settings: { includeImages: false } });
    const photoOnly = {
      data: {
        home: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                {
                  entryId: "tweet-1",
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "1",
                          legacy: {
                            extended_entities: {
                              media: [
                                {
                                  type: "photo",
                                  media_key: "3_1",
                                  media_url_https: "https://p/1.jpg",
                                },
                              ],
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    };
    handle(response("HomeTimeline", photoOnly));
    expect(added).toEqual([]);
  });

  it(`reports "broken" after ${BROKEN_THRESHOLD} consecutive unreadable 200s, "ok" once readable`, () => {
    const { handle, statuses } = setup();
    const unreadable = { data: { home: { something_new: { entries: [1, 2, 3] } } } };
    handle(response("HomeTimeline", unreadable));
    handle(response("HomeTimeline", unreadable));
    expect(statuses).toEqual([]);
    handle(response("HomeTimeline", unreadable));
    expect(statuses).toEqual(["broken"]);
    handle(response("HomeTimeline", loadFixture("home-timeline.json")));
    expect(statuses).toEqual(["broken", "ok"]);
  });

  it("a readable response resets the consecutive count", () => {
    const { handle, statuses } = setup();
    const unreadable = { data: {} };
    handle(response("HomeTimeline", unreadable));
    handle(response("HomeTimeline", unreadable));
    handle(response("HomeTimeline", loadFixture("home-timeline.json")));
    handle(response("HomeTimeline", unreadable));
    handle(response("HomeTimeline", unreadable));
    expect(statuses).toEqual(["ok"]);
  });

  it("does not count non-200 responses, null bodies, or cursor-only pages", () => {
    const { handle, statuses } = setup();
    const cursorOnly = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  { entryId: "cursor-bottom-1", content: { entryType: "TimelineTimelineCursor" } },
                ],
              },
            ],
          },
        },
      },
    };
    for (let i = 0; i < 5; i++) {
      handle(response("HomeTimeline", { errors: [] }, 500));
      handle(response("HomeTimeline", null));
      handle(response("HomeTimeline", cursorOnly));
    }
    expect(statuses).toEqual([]);
  });

  it("does not throw on garbage bodies", () => {
    const { handle } = setup();
    for (const body of [42, "x", [], { data: null }, undefined]) {
      expect(() => handle(response("HomeTimeline", body))).not.toThrow();
    }
  });

  describe("shouldAppendToAuto", () => {
    it("matches only when the mode is auto and the operation targets the page kind", () => {
      expect(shouldAppendToAuto("Likes", "likes", "auto")).toBe(true);
      expect(shouldAppendToAuto("Likes", "home", "auto")).toBe(false);
      expect(shouldAppendToAuto("Likes", "likes", "manual")).toBe(false);
      expect(shouldAppendToAuto("Unknown", "home", "auto")).toBe(false);
    });
  });

  describe("replay buffer (X prefetches the destination page before the URL changes)", () => {
    // The response() helper stamps a fixed receivedAt (1_790_000_000_000) unrelated to the
    // real wall clock, so Date.now() is pinned near it to control the buffer's 15s age check.
    const RECEIVED_AT = 1_790_000_000_000;

    it("re-evaluates a buffered response once navigation.current catches up to it", () => {
      const { handle, added, current } = setup({ url: "https://x.com/home" });
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(RECEIVED_AT);
      try {
        // The Likes response arrives while the page kind is still "home".
        handle(response("Likes", loadFixture("likes.json")));
        expect(added).toEqual([]);
        // The URL (and page kind) only updates afterwards, shortly after.
        nowSpy.mockReturnValue(RECEIVED_AT + 500);
        current.value = getPageInfo("https://x.com/alice/likes");
        expect(added).toHaveLength(1);
        expect(added[0]?.target).toBe("auto");
        expect(ids(added[0]?.items ?? [])).toEqual(["3_30001", "16_30002"]);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("does not replay a response older than the 15s replay window", () => {
      const { handle, added, current } = setup({ url: "https://x.com/home" });
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(RECEIVED_AT);
      try {
        handle(response("Likes", loadFixture("likes.json")));
        expect(added).toEqual([]);
        // 15s+ later, well past the response's receivedAt.
        nowSpy.mockReturnValue(RECEIVED_AT + 15_001);
        current.value = getPageInfo("https://x.com/alice/likes");
        expect(added).toEqual([]);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("does not re-add a response that already matched and was added via the normal path", () => {
      const { handle, added, current } = setup({ url: "https://x.com/home" });
      handle(response("HomeTimeline", loadFixture("home-timeline.json")));
      expect(added).toHaveLength(1);
      // Navigating away and back must not replay the already-added, never-buffered response.
      current.value = getPageInfo("https://x.com/i/bookmarks");
      current.value = getPageInfo("https://x.com/home");
      expect(added).toHaveLength(1);
    });

    it("a buffered HomeTimeline response is not appended once navigation moves to bookmarks", () => {
      // Start on a page kind ("search") that HomeTimeline never matches, so it lands in the
      // buffer, then move to bookmarks: still a kind mismatch, so it must stay unappended
      // (not merely expired — Date.now() is pinned right next to receivedAt).
      const { handle, added, current } = setup({ url: "https://x.com/search" });
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(RECEIVED_AT);
      try {
        handle(response("HomeTimeline", loadFixture("home-timeline.json")));
        expect(added).toEqual([]);
        nowSpy.mockReturnValue(RECEIVED_AT + 500);
        current.value = getPageInfo("https://x.com/i/bookmarks");
        expect(added).toEqual([]);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});
