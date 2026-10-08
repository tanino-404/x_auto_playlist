import { describe, expect, it } from "vitest";
import {
  createInitialPlaylist,
  dedupeItems,
  insertItems,
  insertionIndex,
  parseManualPlaylist,
  pickVideoSource,
  selectVisibleItems,
} from "@/lib/store/playlist";
import type { MediaSource, PlaylistItem } from "@/shared/types";

function makeItem(id: string, sources: MediaSource[] = []): PlaylistItem {
  return {
    id,
    kind: "video",
    postId: id,
    postUrl: `https://x.com/u/status/${id}`,
    author: { name: "u", screenName: "u", avatarUrl: "" },
    text: "",
    thumbnailUrl: "",
    sources,
    playable: true,
    addedAt: 0,
  };
}

const ids = (items: PlaylistItem[]) => items.map((item) => item.id);

describe("dedupeItems", () => {
  it("drops items whose id already exists", () => {
    const result = dedupeItems([makeItem("a"), makeItem("b")], [makeItem("b"), makeItem("c")]);
    expect(ids(result)).toEqual(["c"]);
  });

  it("drops duplicates inside the incoming batch (first wins)", () => {
    const first = makeItem("x");
    const result = dedupeItems([], [first, makeItem("x"), makeItem("y")]);
    expect(ids(result)).toEqual(["x", "y"]);
    expect(result[0]).toBe(first);
  });
});

describe("insertionIndex", () => {
  const items = [makeItem("a"), makeItem("b"), makeItem("c")];

  it("returns the end for 'end'", () => {
    expect(insertionIndex(items, "end", "a")).toBe(3);
  });

  it("returns the slot right after currentId for 'next'", () => {
    expect(insertionIndex(items, "next", "a")).toBe(1);
    expect(insertionIndex(items, "next", "c")).toBe(3);
  });

  it("falls back to the end when currentId is null", () => {
    expect(insertionIndex(items, "next", null)).toBe(3);
  });

  it("falls back to the end when currentId is not in the list", () => {
    expect(insertionIndex(items, "next", "zzz")).toBe(3);
  });
});

describe("insertItems", () => {
  const base = [makeItem("a"), makeItem("b"), makeItem("c")];

  it("inserts after the current item with 'next'", () => {
    const result = insertItems(base, [makeItem("n1"), makeItem("n2")], {
      position: "next",
      currentId: "a",
      dedupe: true,
    });
    expect(ids(result)).toEqual(["a", "n1", "n2", "b", "c"]);
  });

  it("appends with 'next' when nothing is playing", () => {
    const result = insertItems(base, [makeItem("n")], {
      position: "next",
      currentId: null,
      dedupe: true,
    });
    expect(ids(result)).toEqual(["a", "b", "c", "n"]);
  });

  it("dedupes when enabled and keeps duplicates when disabled", () => {
    const incoming = [makeItem("b"), makeItem("d")];
    expect(
      ids(insertItems(base, incoming, { position: "end", currentId: null, dedupe: true })),
    ).toEqual(["a", "b", "c", "d"]);
    expect(
      ids(insertItems(base, incoming, { position: "end", currentId: null, dedupe: false })),
    ).toEqual(["a", "b", "c", "b", "d"]);
  });

  it("returns the same array when nothing is added", () => {
    const result = insertItems(base, [makeItem("a")], {
      position: "end",
      currentId: null,
      dedupe: true,
    });
    expect(result).toBe(base);
  });

  it("does not mutate the input", () => {
    const copy = [...base];
    insertItems(base, [makeItem("z")], { position: "next", currentId: "b", dedupe: true });
    expect(base).toEqual(copy);
  });
});

describe("selectVisibleItems", () => {
  it("switches between auto and manual by mode", () => {
    const playlist = createInitialPlaylist("auto");
    playlist.auto.items = [makeItem("auto-1")];
    playlist.manual.items = [makeItem("manual-1"), makeItem("manual-2")];
    expect(ids(selectVisibleItems(playlist, "auto"))).toEqual(["auto-1"]);
    expect(ids(selectVisibleItems(playlist, "manual"))).toEqual(["manual-1", "manual-2"]);
  });
});

describe("createInitialPlaylist", () => {
  it("starts empty with the given mode", () => {
    expect(createInitialPlaylist("manual")).toEqual({
      mode: "manual",
      auto: { pageKey: "", items: [] },
      manual: { items: [], lastPlayedId: null },
    });
  });
});

describe("parseManualPlaylist", () => {
  it("returns an empty playlist for malformed input", () => {
    expect(parseManualPlaylist(undefined)).toEqual({ items: [], lastPlayedId: null });
    expect(parseManualPlaylist({ items: "nope" })).toEqual({ items: [], lastPlayedId: null });
  });

  it("keeps valid items and lastPlayedId, dropping malformed entries", () => {
    const item = makeItem("a");
    const parsed = parseManualPlaylist({ items: [item, { foo: 1 }], lastPlayedId: "a" });
    expect(parsed).toEqual({ items: [item], lastPlayedId: "a" });
  });
});

describe("pickVideoSource", () => {
  const item = makeItem("v", [
    { url: "hls", mime: "application/x-mpegURL" },
    { url: "low", mime: "video/mp4", bitrate: 256_000 },
    { url: "high", mime: "video/mp4", bitrate: 2_176_000 },
    { url: "mid", mime: "video/mp4", bitrate: 832_000 },
  ]);

  it("picks the highest-bitrate mp4 for highest/auto", () => {
    expect(pickVideoSource(item, "highest")).toBe("high");
    expect(pickVideoSource(item, "auto")).toBe("high");
  });

  it("picks the lowest-bitrate mp4 for lowest", () => {
    expect(pickVideoSource(item, "lowest")).toBe("low");
  });

  it("returns null when there is no mp4", () => {
    expect(
      pickVideoSource(makeItem("x", [{ url: "hls", mime: "application/x-mpegURL" }]), "auto"),
    ).toBeNull();
  });
});
