import { describe, expect, it } from "vitest";
import { getPageInfo, isOverlayUrl } from "@/lib/navigation";

describe("getPageInfo", () => {
  it.each([
    ["https://x.com/home", "home", "home:/home"],
    ["https://x.com/home/", "home", "home:/home"],
    ["https://x.com/i/bookmarks", "bookmarks", "bookmarks:/i/bookmarks"],
    ["https://x.com/i/history", "bookmarks", "bookmarks:/i/history"],
    ["https://x.com/i/history/", "bookmarks", "bookmarks:/i/history"],
    ["https://x.com/i/history?foo=bar", "bookmarks", "bookmarks:/i/history"],
    ["https://x.com/i/history/bookmarks", "bookmarks", "bookmarks:/i/history/bookmarks"],
    ["https://x.com/i/history/bookmarks/", "bookmarks", "bookmarks:/i/history/bookmarks"],
    ["https://x.com/i/history/likes", "likes", "likes:/i/history/likes"],
    ["https://x.com/i/history/likes/", "likes", "likes:/i/history/likes"],
    ["https://x.com/i/history/likes?foo=bar", "likes", "likes:/i/history/likes"],
    ["https://x.com/i/history/unknown", "other", "other:/i/history/unknown"],
    ["https://x.com/alice/likes", "likes", "likes:/alice/likes"],
    ["https://x.com/alice/media", "user-media", "user-media:/alice/media"],
    ["https://x.com/search?q=cats&src=typed_query", "search", "search:/search"],
    ["https://x.com/alice/status/123", "status", "status:/alice/status/123"],
    ["https://x.com/alice/status/123/photo/1", "status", "status:/alice/status/123"],
    ["https://x.com/alice", "other", "other:/alice"],
    ["https://x.com/explore", "other", "other:/explore"],
    ["https://x.com/", "other", "other:/"],
    ["https://x.com/alice/status/abc", "other", "other:/alice/status/abc"],
    ["https://x.com/i/likes", "other", "other:/i/likes"],
  ])("%s → %s", (url, kind, key) => {
    expect(getPageInfo(url)).toEqual({ kind, key, url });
  });

  it("ignores the query string in the key", () => {
    expect(getPageInfo("https://x.com/search?q=a").key).toBe(
      getPageInfo("https://x.com/search?q=b").key,
    );
  });

  it("distinguishes users", () => {
    expect(getPageInfo("https://x.com/alice/likes").key).not.toBe(
      getPageInfo("https://x.com/bob/likes").key,
    );
  });

  it("never throws on garbage", () => {
    expect(getPageInfo("::::").kind).toBe("other");
  });
});

describe("isOverlayUrl", () => {
  it.each([
    ["https://x.com/alice/status/123/photo/1", true],
    ["https://x.com/alice/status/123/video/1", true],
    ["https://x.com/compose/post", true],
    ["https://x.com/alice/status/123", false],
    ["https://x.com/home", false],
  ])("%s → %s", (url, expected) => {
    expect(isOverlayUrl(url)).toBe(expected);
  });
});
