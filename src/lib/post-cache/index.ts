// postId → ParsedPost for every post seen in this tab (docs/architecture.md §4).
// Source for right-click "add" without sending requests of our own (design principle 7).
// A Map keeps insertion order; re-inserting on access makes it an LRU.

import { POST_CACHE_LIMIT } from "@/shared/constants";
import type { ParsedPost } from "@/shared/types";

export interface PostCache {
  put(post: ParsedPost): void;
  get(postId: string): ParsedPost | undefined;
  size(): number;
}

export function createPostCache(limit: number = POST_CACHE_LIMIT): PostCache {
  const max = Math.max(1, Math.floor(limit));
  const map = new Map<string, ParsedPost>();

  return {
    put(post) {
      if (map.has(post.postId)) {
        map.delete(post.postId);
      }
      map.set(post.postId, post);
      while (map.size > max) {
        const oldest = map.keys().next();
        if (oldest.done) {
          break;
        }
        map.delete(oldest.value);
      }
    },
    get(postId) {
      const post = map.get(postId);
      if (post !== undefined) {
        map.delete(postId);
        map.set(postId, post);
      }
      return post;
    },
    size() {
      return map.size;
    },
  };
}
