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
    ["https://x.com/alice", "user-posts", "user-posts:/alice"],
    ["https://x.com/alice/", "user-posts", "user-posts:/alice"],
    ["https://x.com/alice?s=20", "user-posts", "user-posts:/alice"],
    ["https://x.com/Alice_99", "user-posts", "user-posts:/Alice_99"],
    ["https://x.com/alice/with_replies", "user-replies", "user-replies:/alice/with_replies"],
    ["https://x.com/alice/reposts", "user-reposts", "user-reposts:/alice/reposts"],
    ["https://x.com/alice/retweets", "other", "other:/alice/retweets"],
    ["https://x.com/alice/highlights", "other", "other:/alice/highlights"],
    ["https://x.com/alice/with_replies/x", "other", "other:/alice/with_replies/x"],
    ["https://x.com/explore", "other", "other:/explore"],
    ["https://x.com/notifications", "other", "other:/notifications"],
    ["https://x.com/messages", "other", "other:/messages"],
    ["https://x.com/settings", "other", "other:/settings"],
    ["https://x.com/compose", "other", "other:/compose"],
    ["https://x.com/login", "other", "other:/login"],
    ["https://x.com/signup", "other", "other:/signup"],
    ["https://x.com/about", "other", "other:/about"],
    ["https://x.com/tos", "other", "other:/tos"],
    ["https://x.com/privacy", "other", "other:/privacy"],
    ["https://x.com/Explore", "other", "other:/Explore"],
    ["https://x.com/i", "other", "other:/i"],
    ["https://x.com/settings/with_replies", "other", "other:/settings/with_replies"],
    ["https://x.com/this-is-not-a-user", "other", "other:/this-is-not-a-user"],
    ["https://x.com/averyveryverylongname", "other", "other:/averyveryverylongname"],
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

  it("distinguishes profile tabs and users", () => {
    const keys = new Set(
      [
        "https://x.com/alice",
        "https://x.com/alice/with_replies",
        "https://x.com/alice/reposts",
        "https://x.com/alice/media",
        "https://x.com/bob",
      ].map((url) => getPageInfo(url).key),
    );
    expect(keys.size).toBe(5);
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
