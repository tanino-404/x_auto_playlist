import { describe, expect, it } from "vitest";
import { gapToIndex, moveAfter, moveIndex } from "@/lib/store/playlist";
import type { PlaylistItem } from "@/shared/types";

function makeItem(id: string): PlaylistItem {
  return {
    id,
    kind: "video",
    postId: id,
    postUrl: `https://x.com/u/status/${id}`,
    author: { name: "u", screenName: "u", avatarUrl: "" },
    text: "",
    thumbnailUrl: "",
    sources: [],
    playable: true,
    addedAt: 0,
  };
}

const ids = (items: readonly PlaylistItem[]) => items.map((item) => item.id);

describe("moveIndex", () => {
  const list = ["a", "b", "c", "d"] as const;

  it("moves an element down", () => {
    expect(moveIndex(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
  it("moves an element up", () => {
    expect(moveIndex(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("moves to the ends", () => {
    expect(moveIndex(list, 1, 3)).toEqual(["a", "c", "d", "b"]);
    expect(moveIndex(list, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });
  it("does not mutate the input", () => {
    const copy = [...list];
    moveIndex(copy, 0, 3);
    expect(copy).toEqual(list);
  });
  it("returns the same reference for no-op or invalid indices", () => {
    expect(moveIndex(list, 1, 1)).toBe(list);
    expect(moveIndex(list, -1, 2)).toBe(list);
    expect(moveIndex(list, 0, 4)).toBe(list);
    expect(moveIndex(list, 4, 0)).toBe(list);
    expect(moveIndex(list, 0.5, 2)).toBe(list);
    expect(moveIndex([], 0, 0)).toEqual([]);
  });
});

describe("gapToIndex", () => {
  it("maps a drop gap to the destination index", () => {
    // from = 1 in [a, b, c, d]
    expect(gapToIndex(1, 0)).toBe(0);
    expect(gapToIndex(1, 1)).toBe(1); // before itself: no move
    expect(gapToIndex(1, 2)).toBe(1); // after itself: no move
    expect(gapToIndex(1, 3)).toBe(2);
    expect(gapToIndex(1, 4)).toBe(3); // after the last row
  });
  it("round-trips with moveIndex", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveIndex(list, 1, gapToIndex(1, 4))).toEqual(["a", "c", "d", "b"]);
    expect(moveIndex(list, 3, gapToIndex(3, 0))).toEqual(["d", "a", "b", "c"]);
  });
});

describe("moveAfter", () => {
  const items = ["a", "b", "c", "d"].map(makeItem);

  it("moves the item right after the anchor", () => {
    expect(ids(moveAfter(items, "d", "a"))).toEqual(["a", "d", "b", "c"]);
    expect(ids(moveAfter(items, "a", "c"))).toEqual(["b", "c", "a", "d"]);
  });
  it("moves to the front when there is no anchor", () => {
    expect(ids(moveAfter(items, "c", null))).toEqual(["c", "a", "b", "d"]);
    expect(ids(moveAfter(items, "c", "missing"))).toEqual(["c", "a", "b", "d"]);
  });
  it("returns the same list when nothing changes", () => {
    expect(moveAfter(items, "b", "a")).toBe(items);
    expect(moveAfter(items, "b", "b")).toBe(items);
    expect(moveAfter(items, "zz", "a")).toBe(items);
  });
});
