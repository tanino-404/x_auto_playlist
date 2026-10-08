import { describe, expect, it } from "vitest";
import { createPostCache } from "@/lib/post-cache";
import { POST_CACHE_LIMIT } from "@/shared/constants";
import type { ParsedPost } from "@/shared/types";

const post = (postId: string): ParsedPost => ({ postId, items: [] });

describe("createPostCache", () => {
  it("stores and returns posts by id", () => {
    const cache = createPostCache();
    cache.put(post("1"));
    expect(cache.get("1")).toEqual(post("1"));
    expect(cache.get("2")).toBeUndefined();
    expect(cache.size()).toBe(1);
  });

  it("replaces an existing post without growing", () => {
    const cache = createPostCache();
    cache.put(post("1"));
    const updated: ParsedPost = { postId: "1", items: [] };
    cache.put(updated);
    expect(cache.size()).toBe(1);
    expect(cache.get("1")).toBe(updated);
  });

  it("drops the least recently used post past the limit", () => {
    const cache = createPostCache(3);
    cache.put(post("1"));
    cache.put(post("2"));
    cache.put(post("3"));
    cache.get("1"); // 1 becomes most recent → 2 is now the oldest
    cache.put(post("4"));
    expect(cache.size()).toBe(3);
    expect(cache.get("2")).toBeUndefined();
    expect(cache.get("1")).toBeDefined();
    expect(cache.get("3")).toBeDefined();
    expect(cache.get("4")).toBeDefined();
  });

  it("defaults to POST_CACHE_LIMIT", () => {
    const cache = createPostCache();
    for (let i = 0; i < POST_CACHE_LIMIT + 10; i++) {
      cache.put(post(String(i)));
    }
    expect(cache.size()).toBe(POST_CACHE_LIMIT);
    expect(cache.get("0")).toBeUndefined();
    expect(cache.get(String(POST_CACHE_LIMIT + 9))).toBeDefined();
  });
});
