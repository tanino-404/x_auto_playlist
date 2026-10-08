import { describe, expect, it } from "vitest";
import {
  inspectTimelineResponse,
  parseTimelineResponse,
  parseTweetResult,
  parseTweetResults,
} from "@/lib/collector/parse";
import type { ParsedPost } from "@/shared/types";
import { loadFixture, realFixtures } from "./fixtures";

const NOW = 1_790_000_000_000;

function byId(posts: ParsedPost[], postId: string): ParsedPost {
  const post = posts.find((candidate) => candidate.postId === postId);
  if (post === undefined) {
    throw new Error(`post ${postId} not found`);
  }
  return post;
}

function onlyItem(post: ParsedPost) {
  expect(post.items).toHaveLength(1);
  const item = post.items[0];
  if (item === undefined) {
    throw new Error("unreachable");
  }
  return item;
}

describe("parseTimelineResponse: home-timeline.json", () => {
  const posts = parseTimelineResponse(loadFixture("home-timeline.json"), NOW);

  it("returns every readable post in order, skipping the tombstone", () => {
    expect(posts.map((post) => post.postId)).toEqual([
      "1001",
      "1002",
      "1003",
      "1040",
      "1005",
      "1050",
      "1006",
      "1008",
      "1009",
      "1010",
    ]);
    expect(posts.flatMap((post) => post.items)).toHaveLength(12);
  });

  it("① video: mp4 sorted by bitrate desc, then m3u8; metadata filled in", () => {
    const item = onlyItem(byId(posts, "1001"));
    expect(item).toMatchObject({
      id: "7_1001",
      kind: "video",
      postId: "1001",
      postUrl: "https://x.com/alice/status/1001",
      text: "video post https://t.co/v1",
      thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1001/pu/img/thumb.jpg",
      durationMs: 12345,
      playable: true,
      addedAt: NOW,
    });
    expect(item.sources.map((source) => [source.mime, source.bitrate ?? null])).toEqual([
      ["video/mp4", 2176000],
      ["video/mp4", 832000],
      ["video/mp4", 256000],
      ["application/x-mpegURL", null],
    ]);
    expect(item.sources[0]).toMatchObject({ width: 1280, height: 720 });
    expect(item.sources[2]).toMatchObject({ width: 320, height: 180 });
  });

  it("② four photos: ?name=large source, ?name=small thumbnail, mime from extension", () => {
    const post = byId(posts, "1002");
    expect(post.items.map((item) => item.id)).toEqual(["3_2001", "3_2002", "3_2003", "3_2004"]);
    for (const item of post.items) {
      expect(item.kind).toBe("photo");
      expect(item.playable).toBe(true);
      expect(item.sources).toHaveLength(1);
      expect(item.sources[0]?.url).toMatch(/\?name=large$/);
      expect(item.thumbnailUrl).toMatch(/\?name=small$/);
      expect(item.durationMs).toBeUndefined();
    }
    expect(post.items[0]?.sources[0]).toEqual({
      url: "https://pbs.twimg.com/media/p2001.jpg?name=large",
      mime: "image/jpeg",
      width: 1200,
      height: 800,
    });
    expect(post.items[1]?.sources[0]?.mime).toBe("image/png");
  });

  it("③ animated_gif becomes kind 'gif' with its mp4", () => {
    const item = onlyItem(byId(posts, "1003"));
    expect(item.kind).toBe("gif");
    expect(item.playable).toBe(true);
    expect(item.sources).toEqual([
      { url: "https://video.twimg.com/tweet_video/G3001.mp4", mime: "video/mp4", bitrate: 0 },
    ]);
  });

  it("④ repost is expanded to the original post (media and author from the original)", () => {
    expect(posts.some((post) => post.postId === "1004")).toBe(false);
    const item = onlyItem(byId(posts, "1040"));
    expect(item).toMatchObject({
      id: "7_4001",
      kind: "video",
      postId: "1040",
      postUrl: "https://x.com/carol/status/1040",
      text: "original video",
    });
    expect(item.author.screenName).toBe("carol");
  });

  it("⑤ quote yields both the quoting post and the quoted post", () => {
    const body = onlyItem(byId(posts, "1005"));
    expect(body).toMatchObject({ id: "3_5001", kind: "photo", postId: "1005" });
    const quoted = onlyItem(byId(posts, "1050"));
    expect(quoted).toMatchObject({
      id: "7_5001",
      kind: "video",
      postId: "1050",
      postUrl: "https://x.com/dave/status/1050",
    });
  });

  it("⑥ TweetWithVisibilityResults is unwrapped", () => {
    const item = onlyItem(byId(posts, "1006"));
    expect(item).toMatchObject({ id: "7_6001", kind: "video", playable: true });
    expect(item.author.screenName).toBe("carol");
  });

  it("⑦ tombstones are ignored", () => {
    expect(posts.some((post) => post.postId === "1007")).toBe(false);
  });

  it("⑧ a post without media is kept (for the post cache) with no items", () => {
    expect(byId(posts, "1008").items).toEqual([]);
  });

  it("⑨ note_tweet text wins over legacy.full_text", () => {
    const item = onlyItem(byId(posts, "1009"));
    expect(item.text).toBe(
      "This is the full long text of the post, longer than the legacy full_text.",
    );
  });

  it("⑩ authors resolve from both the new (core.*) and legacy structures", () => {
    expect(onlyItem(byId(posts, "1001")).author).toEqual({
      name: "Alice",
      screenName: "alice",
      avatarUrl: "https://pbs.twimg.com/profile_images/101/alice_normal.jpg",
    });
    expect(byId(posts, "1002").items[0]?.author).toEqual({
      name: "Bob",
      screenName: "bob",
      avatarUrl: "https://pbs.twimg.com/profile_images/102/bob_normal.jpg",
    });
  });

  it("excludes ads (promoted- entryId or promotedMetadata) even when they have media", () => {
    expect(posts.some((post) => post.postId === "1011")).toBe(false);
    expect(posts.some((post) => post.postId === "1012")).toBe(false);
    const allIds = posts.flatMap((post) => post.items.map((item) => item.id));
    expect(allIds).not.toContain("13_11001");
    expect(allIds).not.toContain("3_12001");
  });

  it("an HLS-only video is kept but not playable (T-02)", () => {
    const item = onlyItem(byId(posts, "1010"));
    expect(item.playable).toBe(false);
    expect(item.sources.map((source) => source.mime)).toEqual(["application/x-mpegURL"]);
    expect(item.durationMs).toBe(3_600_000);
  });
});

describe("parseTimelineResponse: other locations", () => {
  it("bookmarks.json (data.bookmark_timeline_v2.timeline.instructions)", () => {
    const posts = parseTimelineResponse(loadFixture("bookmarks.json"), NOW);
    expect(posts.map((post) => post.postId)).toEqual(["2001"]);
    expect(posts[0]?.items[0]?.kind).toBe("video");
  });

  it("likes.json (data.user.result.timeline.timeline.instructions)", () => {
    const posts = parseTimelineResponse(loadFixture("likes.json"), NOW);
    expect(posts.map((post) => post.postId)).toEqual(["3001", "3002"]);
    expect(posts.flatMap((post) => post.items.map((item) => item.kind))).toEqual(["photo", "gif"]);
  });

  it("add-to-module.json: module entries and TimelineAddToModule (promoted module item dropped)", () => {
    const posts = parseTimelineResponse(loadFixture("add-to-module.json"), NOW);
    expect(posts.map((post) => post.postId)).toEqual(["4001", "4002", "4003"]);
    expect(posts.flatMap((post) => post.items.map((item) => item.id))).toEqual([
      "7_40001",
      "3_40002",
      "16_40003",
    ]);
  });

  it("finds instructions wherever they are", () => {
    const home = loadFixture("home-timeline.json") as {
      data: { home: { home_timeline_urt: unknown } };
    };
    const moved = { data: { somewhere: { else: [home.data.home.home_timeline_urt] } } };
    expect(parseTimelineResponse(moved, NOW)).toHaveLength(10);
  });

  it("handles several operations bundled under one data object (bundle.* requests)", () => {
    const home = loadFixture("home-timeline.json") as { data: Record<string, unknown> };
    const likes = loadFixture("likes.json") as { data: Record<string, unknown> };
    const bundled = { data: { ...home.data, ...likes.data } };
    expect(parseTimelineResponse(bundled, NOW).map((post) => post.postId)).toEqual([
      "1001",
      "1002",
      "1003",
      "1040",
      "1005",
      "1050",
      "1006",
      "1008",
      "1009",
      "1010",
      "3001",
      "3002",
    ]);
  });

  it("ignores unknown instruction types (TimelineShowAlert carries users, not posts)", () => {
    const body = {
      data: {
        home: {
          instructions: [
            {
              type: "TimelineShowAlert",
              usersResults: [{ result: { rest_id: "1" } }],
              entries: [
                {
                  entryId: "tweet-1",
                  content: {
                    itemContent: {
                      tweet_results: { result: { __typename: "Tweet", rest_id: "1" } },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    };
    expect(parseTimelineResponse(body, NOW)).toEqual([]);
  });
});

describe("parseTimelineResponse: robustness", () => {
  it.each([null, undefined, 42, "text", [], {}, { data: null }, { data: { instructions: 1 } }])(
    "returns [] for %j",
    (body) => {
      expect(parseTimelineResponse(body, NOW)).toEqual([]);
    },
  );

  it("skips broken elements and keeps going", () => {
    const body = loadFixture("home-timeline.json") as {
      data: {
        home: { home_timeline_urt: { instructions: Array<{ type: string; entries?: unknown[] }> } };
      };
    };
    const entries =
      body.data.home.home_timeline_urt.instructions.find((i) => i.type === "TimelineAddEntries")
        ?.entries ?? [];
    entries.unshift(null, 7, {
      entryId: "tweet-x",
      content: { itemContent: { tweet_results: 5 } },
    });
    // A media element with garbage in it.
    const first = entries.find(
      (e) => (e as { entryId?: string } | null)?.entryId === "tweet-1001",
    ) as {
      content: {
        itemContent: {
          tweet_results: { result: { legacy: { extended_entities: { media: unknown[] } } } };
        };
      };
    };
    first.content.itemContent.tweet_results.result.legacy.extended_entities.media.push(
      null,
      { type: "video" },
      { type: "hologram", media_key: "x" },
    );
    const posts = parseTimelineResponse(body, NOW);
    expect(posts).toHaveLength(10);
    expect(byId(posts, "1001").items.map((item) => item.id)).toEqual(["7_1001"]);
  });

  it("uses id_str when media_key is missing", () => {
    const result = {
      __typename: "Tweet",
      rest_id: "9",
      legacy: {
        full_text: "",
        extended_entities: {
          media: [{ type: "photo", id_str: "555", media_url_https: "https://p/x.webp" }],
        },
      },
    };
    const post = parseTweetResult(result, NOW);
    expect(post?.items[0]?.id).toBe("555");
    expect(post?.items[0]?.sources[0]?.mime).toBe("image/webp");
    // No author → a screen-name-less status URL.
    expect(post?.items[0]?.postUrl).toBe("https://x.com/i/status/9");
  });

  it("parseTweetResult returns null for tombstones/unavailable and the original for reposts", () => {
    expect(parseTweetResult({ __typename: "TweetTombstone" })).toBeNull();
    expect(parseTweetResult({ __typename: "TweetUnavailable", reason: "Suspended" })).toBeNull();
    expect(parseTweetResult(null)).toBeNull();
    const repost = {
      __typename: "Tweet",
      rest_id: "1",
      legacy: { retweeted_status_result: { result: { __typename: "Tweet", rest_id: "2" } } },
    };
    expect(parseTweetResult(repost)?.postId).toBe("2");
    expect(parseTweetResults(repost).map((post) => post.postId)).toEqual(["2"]);
  });
});

describe("inspectTimelineResponse", () => {
  it("counts content entries but not cursors", () => {
    const inspection = inspectTimelineResponse(loadFixture("home-timeline.json"), NOW);
    expect(inspection.instructionsFound).toBe(true);
    expect(inspection.contentEntryCount).toBe(10);
  });

  it("reports a cursor-only response as found-but-empty", () => {
    const body = {
      data: {
        x: {
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
    };
    expect(inspectTimelineResponse(body)).toEqual({
      posts: [],
      instructionsFound: true,
      contentEntryCount: 0,
    });
  });
});

/**
 * True when the capture contains at least one post entry: an entryId starting with "tweet-",
 * or a module item such as "profile-grid-0-tweet-123" (ads excluded). Scans the raw JSON
 * independently of the parser so that a parser regression still fails the test.
 */
function hasPostEntries(value: unknown, depth = 0): boolean {
  if (depth > 64 || typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((element) => hasPostEntries(element, depth + 1));
  }
  const entryId = (value as { entryId?: unknown }).entryId;
  if (
    typeof entryId === "string" &&
    !entryId.startsWith("promoted-") &&
    /(^|-)tweet-\d+/.test(entryId)
  ) {
    return true;
  }
  return Object.values(value).some((child) => hasPostEntries(child, depth + 1));
}

describe("real captures (tests/fixtures/real/, optional)", () => {
  // Skipped when the file is a placeholder (no "data" key) or holds no post entries
  // (e.g. an empty bookmarks page that only returns cursors).
  for (const [name, body] of Object.entries(realFixtures)) {
    const hasData = typeof body === "object" && body !== null && "data" in body;
    it.skipIf(!hasData || !hasPostEntries(body))(`${name} yields at least one post`, () => {
      expect(parseTimelineResponse(body).length).toBeGreaterThan(0);
    });
  }
  if (Object.keys(realFixtures).length === 0) {
    it.skip("no real captures present", () => {});
  }
});

describe("post flags (F-4C)", () => {
  const photo = (key: string) => ({
    type: "photo",
    media_key: key,
    media_url_https: `https://pbs.twimg.com/media/${key}.jpg`,
  });
  const tweet = (restId: string, legacy: Record<string, unknown>) => ({
    __typename: "Tweet",
    rest_id: restId,
    legacy: { full_text: "", ...legacy },
  });

  it("copies legacy.favorited / bookmarked / retweeted into every item of the post", () => {
    const result = tweet("10", {
      favorited: true,
      bookmarked: false,
      retweeted: true,
      extended_entities: { media: [photo("a"), photo("b")] },
    });
    const post = parseTweetResult(result, NOW);
    expect(post?.items.map((item) => item.post)).toEqual([
      { favorited: true, bookmarked: false, retweeted: true },
      { favorited: true, bookmarked: false, retweeted: true },
    ]);
    // Each item owns its flags object (store updates replace it per item).
    expect(post?.items[0]?.post).not.toBe(post?.items[1]?.post);
  });

  it("omits post when no flag is present, and treats a missing single flag as false", () => {
    const unknown = parseTweetResult(
      tweet("11", { extended_entities: { media: [photo("c")] } }),
      NOW,
    );
    expect(unknown?.items[0]).not.toHaveProperty("post");
    const partial = parseTweetResult(
      tweet("12", { favorited: true, extended_entities: { media: [photo("d")] } }),
      NOW,
    );
    expect(partial?.items[0]?.post).toEqual({
      favorited: true,
      bookmarked: false,
      retweeted: false,
    });
  });

  it("uses the original post's flags for a repost", () => {
    const repost = tweet("20", {
      favorited: false,
      bookmarked: false,
      retweeted: true,
      retweeted_status_result: {
        result: tweet("21", {
          favorited: true,
          bookmarked: true,
          retweeted: true,
          extended_entities: { media: [photo("e")] },
        }),
      },
    });
    const [post] = parseTweetResults(repost, NOW);
    expect(post?.postId).toBe("21");
    expect(post?.items[0]?.post).toEqual({ favorited: true, bookmarked: true, retweeted: true });
  });

  it("keeps separate flags for a quote and the quoted post", () => {
    const quote = {
      ...tweet("30", {
        favorited: true,
        bookmarked: false,
        retweeted: false,
        extended_entities: { media: [photo("f")] },
      }),
      quoted_status_result: {
        result: tweet("31", {
          favorited: false,
          bookmarked: true,
          retweeted: false,
          extended_entities: { media: [photo("g")] },
        }),
      },
    };
    const posts = parseTweetResults(quote, NOW);
    expect(posts.map((post) => [post.postId, post.items[0]?.post])).toEqual([
      ["30", { favorited: true, bookmarked: false, retweeted: false }],
      ["31", { favorited: false, bookmarked: true, retweeted: false }],
    ]);
  });

  it("synthetic fixtures carry no flags, so their items have no post", () => {
    const posts = parseTimelineResponse(loadFixture("home-timeline.json"), NOW);
    expect(posts.flatMap((post) => post.items).every((item) => item.post === undefined)).toBe(true);
  });
});
