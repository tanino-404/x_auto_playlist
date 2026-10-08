import { describe, expect, it } from "vitest";
import { playedIdsToRemove, removeManyFromManual } from "@/lib/store/playlist";
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

const items = ["a", "b", "c", "d"].map(makeItem);

describe("playedIdsToRemove", () => {
  it("returns played items except the one playing, in list order", () => {
    expect(playedIdsToRemove(items, ["c", "a", "b"], "b")).toEqual(["a", "c"]);
  });
  it("keeps the playing item even when it is in playedIds", () => {
    expect(playedIdsToRemove(items, ["a"], "a")).toEqual([]);
  });
  it("removes every played item once playback stopped", () => {
    expect(playedIdsToRemove(items, ["a", "b"], null)).toEqual(["a", "b"]);
  });
  it("ignores played ids that are not in the list", () => {
    expect(playedIdsToRemove(items, ["x", "d"], "a")).toEqual(["d"]);
  });
  it("returns nothing when nothing was played", () => {
    expect(playedIdsToRemove(items, [], "a")).toEqual([]);
  });
});

describe("removeManyFromManual", () => {
  it("removes the ids and clears a removed lastPlayedId", () => {
    const manual = { items, lastPlayedId: "b" };
    const next = removeManyFromManual(manual, ["a", "b"]);
    expect(next.items.map((item) => item.id)).toEqual(["c", "d"]);
    expect(next.lastPlayedId).toBeNull();
  });
  it("keeps lastPlayedId when it survives", () => {
    const manual = { items, lastPlayedId: "d" };
    expect(removeManyFromManual(manual, ["a"]).lastPlayedId).toBe("d");
  });
  it("returns the same object when nothing matches", () => {
    const manual = { items, lastPlayedId: null };
    expect(removeManyFromManual(manual, [])).toBe(manual);
    expect(removeManyFromManual(manual, ["zz"])).toBe(manual);
  });
});
