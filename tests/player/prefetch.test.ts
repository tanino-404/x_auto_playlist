import { describe, expect, it } from "vitest";
import type { NextInput } from "@/lib/player/logic";
import {
  canUsePrefetched,
  decideNextPlanned,
  decidePrevSkipping,
  planNext,
  planPrefetch,
} from "@/lib/player/prefetch";

const ids = ["a", "b", "c", "d"];

function input(overrides: Partial<Omit<NextInput, "reason">> = {}): Omit<NextInput, "reason"> {
  return {
    ids,
    currentId: "a",
    loop: "all",
    shuffle: false,
    playedIds: [],
    random: () => 0,
    ...overrides,
  };
}

/** A random() that returns the given values in order (then repeats the last one). */
function sequence(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] as number;
}

describe("planNext", () => {
  it("is the following item in order", () => {
    expect(planNext(input(), null).id).toBe("b");
    expect(planNext(input({ currentId: "d" }), null).id).toBe("a");
    expect(planNext(input({ currentId: "d", loop: "off" }), null).id).toBeNull();
  });

  it("with loop one it is the following item (auto repeat reuses the loaded element)", () => {
    expect(planNext(input({ loop: "one" }), null).id).toBe("b");
  });

  it("keeps the shuffle draw while the plan is valid", () => {
    const first = planNext(input({ shuffle: true, random: () => 0.99 }), null);
    expect(first.id).toBe("d");
    // A different random() would pick another item, but the plan is kept.
    const again = planNext(input({ shuffle: true, random: () => 0 }), first);
    expect(again).toBe(first);
  });

  it("draws again when the current item, shuffle or loop changed, or the item left", () => {
    const first = planNext(input({ shuffle: true, random: () => 0.99 }), null);
    expect(planNext(input({ shuffle: true, currentId: "b" }), first).fromId).toBe("b");
    expect(planNext(input({ shuffle: true, loop: "off" }), first)).not.toBe(first);
    expect(planNext(input({ shuffle: false }), first).id).toBe("b");
    expect(planNext(input({ shuffle: true, ids: ["a", "b", "c"] }), first).id).toBe("b");
  });
});

describe("decideNextPlanned", () => {
  it("uses the shuffle plan so the prefetched item is the one that plays", () => {
    const plan = planNext(input({ shuffle: true, random: sequence(0.99) }), null);
    const decision = decideNextPlanned(
      { ...input({ shuffle: true, random: () => 0 }), reason: "auto" },
      plan,
    );
    expect(decision).toEqual({ id: "d", resetPlayed: false });
  });

  it("keeps resetPlayed of the plan", () => {
    const played = input({ shuffle: true, playedIds: ["a", "b", "c", "d"], random: () => 0 });
    const plan = planNext(played, null);
    expect(plan.resetPlayed).toBe(true);
    expect(decideNextPlanned({ ...played, reason: "user" }, plan)).toEqual({
      id: plan.id,
      resetPlayed: true,
    });
  });

  it("loop one + auto still repeats the current item", () => {
    const plan = planNext(input({ shuffle: true, loop: "one" }), null);
    expect(
      decideNextPlanned({ ...input({ shuffle: true, loop: "one" }), reason: "auto" }, plan).id,
    ).toBe("a");
  });

  it("ignores the plan without shuffle or for another item", () => {
    const plan = { fromId: "a", shuffle: true, loop: "all" as const, id: "c", resetPlayed: false };
    expect(decideNextPlanned({ ...input(), reason: "user" }, plan).id).toBe("b");
    expect(
      decideNextPlanned({ ...input({ shuffle: true, currentId: "b" }), reason: "user" }, plan).id,
    ).not.toBe("c");
    expect(decideNextPlanned({ ...input(), reason: "user" }, null).id).toBe("b");
  });

  it("ignores a plan whose item was removed", () => {
    const plan = { fromId: "a", shuffle: true, loop: "all" as const, id: "z", resetPlayed: false };
    expect(decideNextPlanned({ ...input({ shuffle: true }), reason: "user" }, plan).id).toBe("b");
  });
});

describe("decidePrevSkipping", () => {
  const prevInput = {
    ids,
    currentId: "c",
    loop: "all" as const,
    shuffle: false,
    playedIds: [],
    currentTime: 0,
  };

  it("returns the previous item when it is playable", () => {
    expect(decidePrevSkipping(prevInput, () => true)).toEqual({ type: "play", id: "b" });
  });

  it("goes further back over unplayable items", () => {
    expect(decidePrevSkipping(prevInput, (id) => id !== "b")).toEqual({ type: "play", id: "a" });
    // Wraps with loop all.
    expect(decidePrevSkipping(prevInput, (id) => id === "c" || id === "d")).toEqual({
      type: "play",
      id: "d",
    });
  });

  it("restarts the current item when nothing earlier is playable", () => {
    expect(decidePrevSkipping(prevInput, (id) => id === "c")).toEqual({ type: "restart" });
    expect(
      decidePrevSkipping({ ...prevInput, loop: "off" }, (id) => id === "c" || id === "d"),
    ).toEqual({ type: "restart" });
  });

  it("is none when nothing (including the current item) is playable", () => {
    expect(decidePrevSkipping(prevInput, () => false)).toEqual({ type: "none" });
  });

  it("keeps the restart rule after 3 seconds", () => {
    expect(decidePrevSkipping({ ...prevInput, currentTime: 5 }, () => false)).toEqual({
      type: "restart",
    });
  });

  it("walks the shuffle history", () => {
    const shuffled = { ...prevInput, shuffle: true, playedIds: ["d", "b", "c"] };
    expect(decidePrevSkipping(shuffled, (id) => id !== "b")).toEqual({ type: "play", id: "d" });
  });
});

describe("planPrefetch", () => {
  const current = { id: "a", url: "https://video/a.mp4" };
  const nextVideo = { id: "b", kind: "video" as const, url: "https://video/b.mp4" };
  const prevVideo = { id: "d", kind: "video" as const, url: "https://video/d.mp4" };
  const nextPhoto = { id: "b", kind: "photo" as const, url: "https://img/b.jpg" };
  const prevPhoto = { id: "d", kind: "photo" as const, url: "https://img/d.jpg" };

  it("off: nothing", () => {
    expect(planPrefetch("off", current, nextVideo, prevVideo)).toEqual({
      video: null,
      images: [],
      nextId: null,
    });
  });

  it("next: the next video with preload auto", () => {
    expect(planPrefetch("next", current, nextVideo, prevVideo)).toEqual({
      video: { id: "b", url: nextVideo.url, preload: "auto" },
      images: [],
      nextId: "b",
    });
  });

  it("next: a photo goes to an Image", () => {
    expect(planPrefetch("next", current, nextPhoto, null)).toEqual({
      video: null,
      images: [{ id: "b", url: nextPhoto.url }],
      nextId: "b",
    });
  });

  it("GIFs are prefetched like videos", () => {
    const gif = { id: "b", kind: "gif" as const, url: "https://video/b-gif.mp4" };
    expect(planPrefetch("next", current, gif, null).video?.preload).toBe("auto");
  });

  it("both: the previous item lightly when the spare video is free", () => {
    expect(planPrefetch("both", current, nextVideo, prevVideo).video?.id).toBe("b");
    expect(planPrefetch("both", current, nextPhoto, prevVideo)).toEqual({
      video: { id: "d", url: prevVideo.url, preload: "metadata" },
      images: [{ id: "b", url: nextPhoto.url }],
      nextId: "b",
    });
    expect(planPrefetch("both", current, nextVideo, prevPhoto).images).toEqual([
      { id: "d", url: prevPhoto.url },
    ]);
    expect(planPrefetch("next", current, nextPhoto, prevVideo).video).toBeNull();
  });

  it("skips the current item, the URL on screen and duplicates", () => {
    expect(planPrefetch("next", current, { ...nextVideo, id: "a" }, null).nextId).toBeNull();
    expect(
      planPrefetch("next", current, { ...nextVideo, url: current.url }, null).video,
    ).toBeNull();
    expect(planPrefetch("both", current, nextPhoto, { ...prevPhoto, id: "b" }).images).toHaveLength(
      1,
    );
    expect(planPrefetch("both", current, null, null)).toEqual({
      video: null,
      images: [],
      nextId: null,
    });
  });
});

describe("canUsePrefetched", () => {
  it("matches only the same non-empty URL", () => {
    expect(canUsePrefetched("https://video/b.mp4", "https://video/b.mp4")).toBe(true);
    expect(canUsePrefetched("https://video/b-360.mp4", "https://video/b.mp4")).toBe(false);
    expect(canUsePrefetched(null, "https://video/b.mp4")).toBe(false);
    expect(canUsePrefetched(undefined, "")).toBe(false);
    expect(canUsePrefetched("", "")).toBe(false);
  });
});
