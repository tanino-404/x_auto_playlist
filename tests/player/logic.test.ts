import { describe, expect, it } from "vitest";
import type { NextInput } from "@/lib/player/logic";
import {
  bufferedEnd,
  decideNext,
  decidePrev,
  formatSpeed,
  formatTime,
  formatVolume,
  listResolutions,
  nextLoopMode,
  normalizeSpeed,
  qualityLabel,
  roundVolume,
  sameQuality,
  selectSource,
  sourceResolution,
} from "@/lib/player/logic";
import type { MediaSource } from "@/shared/types";

const ids = ["a", "b", "c"];

function next(overrides: Partial<NextInput>) {
  return decideNext({
    ids,
    currentId: "a",
    loop: "all",
    shuffle: false,
    playedIds: [],
    random: () => 0,
    reason: "auto",
    ...overrides,
  });
}

describe("decideNext (sequential)", () => {
  it("loop all: moves forward and wraps at the end", () => {
    expect(next({ currentId: "a" }).id).toBe("b");
    expect(next({ currentId: "c" }).id).toBe("a");
  });

  it("loop off: moves forward and stops at the end", () => {
    expect(next({ loop: "off", currentId: "b" }).id).toBe("c");
    expect(next({ loop: "off", currentId: "c" })).toEqual({ id: null, resetPlayed: false });
  });

  it("loop one: repeats on auto advance, moves on (and wraps) for user / skip", () => {
    expect(next({ loop: "one", currentId: "b" }).id).toBe("b");
    expect(next({ loop: "one", currentId: "c" }).id).toBe("c");
    expect(next({ loop: "one", currentId: "b", reason: "user" }).id).toBe("c");
    expect(next({ loop: "one", currentId: "c", reason: "user" }).id).toBe("a");
  });

  it("empty list / nothing current / detached current", () => {
    expect(next({ ids: [] }).id).toBeNull();
    expect(next({ currentId: null }).id).toBe("a");
    expect(next({ currentId: "zzz" }).id).toBeNull();
  });

  it("single item: loop all repeats it, loop off stops", () => {
    expect(next({ ids: ["a"], currentId: "a" }).id).toBe("a");
    expect(next({ ids: ["a"], currentId: "a", loop: "off" }).id).toBeNull();
  });
});

describe("decideNext (shuffle)", () => {
  it("picks only from unplayed items (current counts as played)", () => {
    const list = ["a", "b", "c", "d", "e"];
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const result = next({
        ids: list,
        currentId: "c",
        shuffle: true,
        playedIds: ["a", "c"],
        random: () => r,
      });
      expect(["b", "d", "e"]).toContain(result.id);
      expect(result.resetPlayed).toBe(false);
    }
  });

  it("uses random() to choose among the unplayed items", () => {
    const base = { ids: ["a", "b", "c", "d"], currentId: "a", shuffle: true, playedIds: ["a"] };
    expect(next({ ...base, random: () => 0 }).id).toBe("b");
    expect(next({ ...base, random: () => 0.5 }).id).toBe("c");
    expect(next({ ...base, random: () => 0.999 }).id).toBe("d");
  });

  it("all played: resets playedIds and redraws, avoiding the current item", () => {
    for (const r of [0, 0.5, 0.99]) {
      const result = next({
        currentId: "b",
        shuffle: true,
        playedIds: ["a", "b", "c"],
        random: () => r,
      });
      expect(result.resetPlayed).toBe(true);
      expect(["a", "c"]).toContain(result.id);
    }
  });

  it("all played with loop off: stops", () => {
    expect(
      next({ currentId: "b", shuffle: true, loop: "off", playedIds: ["a", "b", "c"] }),
    ).toEqual({ id: null, resetPlayed: false });
  });

  it("loop one wins over shuffle on auto advance", () => {
    expect(next({ currentId: "b", shuffle: true, loop: "one" }).id).toBe("b");
  });

  it("single item: redraws the same item", () => {
    const result = next({ ids: ["a"], currentId: "a", shuffle: true, playedIds: ["a"] });
    expect(result).toEqual({ id: "a", resetPlayed: true });
  });
});

describe("decidePrev", () => {
  const base = {
    ids,
    currentId: "b",
    loop: "all" as const,
    shuffle: false,
    playedIds: [] as string[],
    currentTime: 0,
  };

  it("restarts from 3 seconds on", () => {
    expect(decidePrev({ ...base, currentTime: 3 })).toEqual({ type: "restart" });
    expect(decidePrev({ ...base, currentTime: 42 })).toEqual({ type: "restart" });
  });

  it("goes to the previous item before 3 seconds", () => {
    expect(decidePrev({ ...base, currentTime: 2.9 })).toEqual({ type: "play", id: "a" });
  });

  it("at the head: wraps with loop all / one, restarts with loop off", () => {
    expect(decidePrev({ ...base, currentId: "a" })).toEqual({ type: "play", id: "c" });
    expect(decidePrev({ ...base, currentId: "a", loop: "one" })).toEqual({ type: "play", id: "c" });
    expect(decidePrev({ ...base, currentId: "a", loop: "off" })).toEqual({ type: "restart" });
  });

  it("shuffle: follows the play history", () => {
    expect(
      decidePrev({ ...base, shuffle: true, currentId: "a", playedIds: ["c", "b", "a"] }),
    ).toEqual({ type: "play", id: "b" });
    expect(decidePrev({ ...base, shuffle: true, currentId: "c", playedIds: ["c"] })).toEqual({
      type: "restart",
    });
  });

  it("nothing current", () => {
    expect(decidePrev({ ...base, currentId: null })).toEqual({ type: "play", id: "a" });
    expect(decidePrev({ ...base, ids: [], currentId: null })).toEqual({ type: "none" });
  });
});

describe("quality selection", () => {
  const mp4 = (url: string, extra: Partial<MediaSource> = {}): MediaSource => ({
    url,
    mime: "video/mp4",
    ...extra,
  });
  const sources: MediaSource[] = [
    mp4("https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/hi.mp4", { bitrate: 2176000 }),
    mp4("https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/640x360/mid.mp4", { bitrate: 832000 }),
    mp4("https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/480x270/lo.mp4", { bitrate: 256000 }),
    { url: "https://video.twimg.com/ext_tw_video/1/pu/pl/x.m3u8", mime: "application/x-mpegURL" },
  ];

  it("extracts the resolution from fields or the URL", () => {
    expect(sourceResolution(mp4("https://x/a.mp4", { width: 1920, height: 1080 }))).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(sourceResolution(sources[1] as MediaSource)).toEqual({ width: 640, height: 360 });
    expect(sourceResolution(mp4("https://x/a.mp4"))).toBeNull();
  });

  it("labels by the shorter side", () => {
    expect(qualityLabel(sources[0] as MediaSource)).toBe("720p");
    expect(qualityLabel(mp4("https://v/vid/720x1280/a.mp4"))).toBe("720p");
    expect(qualityLabel(mp4("https://x/a.mp4"))).toBeNull();
  });

  it("highest / lowest go by bitrate, ignoring non-mp4", () => {
    const shuffled = [sources[2], sources[3], sources[0], sources[1]] as MediaSource[];
    expect(selectSource(shuffled, "highest", null)?.url).toContain("1280x720");
    expect(selectSource(shuffled, "lowest", null)?.url).toContain("480x270");
  });

  it("auto picks the smallest source at least as wide as the video area", () => {
    expect(selectSource(sources, "auto", 300)?.url).toContain("480x270");
    expect(selectSource(sources, "auto", 480)?.url).toContain("480x270");
    expect(selectSource(sources, "auto", 481)?.url).toContain("640x360");
    expect(selectSource(sources, "auto", 640)?.url).toContain("640x360");
    expect(selectSource(sources, "auto", 641)?.url).toContain("1280x720");
  });

  it("auto: a 480px area at devicePixelRatio 2 (960) gets 720p", () => {
    expect(selectSource(sources, "auto", 480 * 2)?.url).toContain("1280x720");
  });

  it("auto: nothing wide enough → the widest", () => {
    expect(selectSource(sources, "auto", 4000)?.url).toContain("1280x720");
  });

  it("auto: equal widths keep the higher bitrate", () => {
    const same = [
      mp4("https://v/vid/640x360/lo.mp4", { bitrate: 100 }),
      mp4("https://v/vid/640x360/hi.mp4", { bitrate: 900 }),
    ];
    expect(selectSource(same, "auto", 600)?.url).toContain("hi.mp4");
  });

  it("auto without a width or resolution info falls back to the highest", () => {
    expect(selectSource(sources, "auto", null)?.url).toContain("1280x720");
    const noRes = [mp4("https://x/a.mp4", { bitrate: 1 }), mp4("https://x/b.mp4", { bitrate: 9 })];
    expect(selectSource(noRes, "auto", 480)?.url).toBe("https://x/b.mp4");
  });

  it("returns null without mp4", () => {
    expect(selectSource([sources[3] as MediaSource], "auto", 480)).toBeNull();
    expect(selectSource([], "highest", null)).toBeNull();
  });
});

describe("explicit resolution ({ height })", () => {
  const mp4 = (url: string, extra: Partial<MediaSource> = {}): MediaSource => ({
    url,
    mime: "video/mp4",
    ...extra,
  });
  const sources: MediaSource[] = [
    mp4("https://v/vid/avc1/1920x1080/fhd.mp4", { bitrate: 10368000 }),
    mp4("https://v/vid/avc1/1280x720/hi.mp4", { bitrate: 2176000 }),
    mp4("https://v/vid/avc1/640x360/mid.mp4", { bitrate: 832000 }),
    mp4("https://v/vid/avc1/480x270/lo.mp4", { bitrate: 256000 }),
    { url: "https://v/pl/x.m3u8", mime: "application/x-mpegURL" },
  ];

  it("picks the matching resolution regardless of the target width", () => {
    expect(selectSource(sources, { height: 720 }, 300)?.url).toContain("1280x720");
    expect(selectSource(sources, { height: 270 }, 4000)?.url).toContain("480x270");
    expect(selectSource(sources, { height: 1080 }, null)?.url).toContain("1920x1080");
  });

  it("falls back to the nearest resolution, the higher one on a tie", () => {
    expect(selectSource(sources, { height: 480 }, null)?.url).toContain("640x360");
    expect(selectSource(sources, { height: 2160 }, null)?.url).toContain("1920x1080");
    expect(selectSource(sources, { height: 100 }, null)?.url).toContain("480x270");
    // 540 is 180 from both 360 and 720 → 720.
    expect(selectSource(sources, { height: 540 }, null)?.url).toContain("1280x720");
  });

  it("uses the height field when present and keeps the higher bitrate on equal resolutions", () => {
    const withFields = [
      mp4("https://x/a.mp4", { width: 1280, height: 720, bitrate: 100 }),
      mp4("https://x/b.mp4", { width: 1280, height: 720, bitrate: 900 }),
      mp4("https://x/c.mp4", { width: 640, height: 360, bitrate: 50 }),
    ];
    expect(selectSource(withFields, { height: 720 }, null)?.url).toBe("https://x/b.mp4");
    expect(selectSource(withFields, { height: 360 }, null)?.url).toBe("https://x/c.mp4");
  });

  it("portrait videos go by the shorter side", () => {
    const portrait = [
      mp4("https://v/vid/720x1280/p720.mp4", { bitrate: 2176000 }),
      mp4("https://v/vid/480x852/p480.mp4", { bitrate: 950000 }),
      mp4("https://v/vid/320x568/p320.mp4", { bitrate: 632000 }),
    ];
    expect(selectSource(portrait, { height: 720 }, null)?.url).toContain("720x1280");
    expect(selectSource(portrait, { height: 1280 }, null)?.url).toContain("720x1280");
    expect(selectSource(portrait, { height: 360 }, null)?.url).toContain("320x568");
    expect(listResolutions(portrait)).toEqual([720, 480, 320]);
  });

  it("without resolution info falls back to the highest", () => {
    const noRes = [mp4("https://x/a.mp4", { bitrate: 1 }), mp4("https://x/b.mp4", { bitrate: 9 })];
    expect(selectSource(noRes, { height: 720 }, null)?.url).toBe("https://x/b.mp4");
    expect(selectSource([sources[4] as MediaSource], { height: 720 }, null)).toBeNull();
  });

  it("listResolutions: distinct, highest first, mp4 only", () => {
    const mixed: MediaSource[] = [
      mp4("https://v/vid/640x360/a.mp4", { bitrate: 800 }),
      mp4("https://v/vid/1280x720/b.mp4"),
      mp4("https://v/vid/640x360/c.mp4", { bitrate: 400 }),
      mp4("https://x/unknown.mp4"),
      mp4("https://x/d.mp4", { width: 480, height: 270 }),
      { url: "https://v/vid/1920x1080/x.m3u8", mime: "application/x-mpegURL" },
    ];
    expect(listResolutions(mixed)).toEqual([720, 360, 270]);
    expect(listResolutions(sources)).toEqual([1080, 720, 360, 270]);
    expect(listResolutions([])).toEqual([]);
  });

  it("sameQuality compares heights structurally", () => {
    expect(sameQuality({ height: 720 }, { height: 720 })).toBe(true);
    expect(sameQuality({ height: 720 }, { height: 360 })).toBe(false);
    expect(sameQuality("auto", "auto")).toBe(true);
    expect(sameQuality("auto", { height: 720 })).toBe(false);
    expect(sameQuality("highest", "lowest")).toBe(false);
  });
});

describe("formatTime", () => {
  it("m:ss under an hour", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(12.9)).toBe("0:12");
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(3599)).toBe("59:59");
  });

  it("h:mm:ss from an hour", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3725)).toBe("1:02:05");
  });

  it("invalid values read 0:00", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });
});

describe("volume", () => {
  it("rounds to 5% steps and clamps", () => {
    expect(roundVolume(0.5)).toBe(0.5);
    expect(roundVolume(0.52)).toBe(0.5);
    expect(roundVolume(0.53)).toBe(0.55);
    expect(roundVolume(0.1 + 0.05)).toBe(0.15);
    expect(roundVolume(-1)).toBe(0);
    expect(roundVolume(2)).toBe(1);
    expect(roundVolume(Number.NaN)).toBe(0);
  });

  it("formats as a percentage", () => {
    expect(formatVolume(0.5)).toBe("50%");
    expect(formatVolume(1)).toBe("100%");
    expect(formatVolume(0)).toBe("0%");
  });
});

describe("speed / loop / buffered", () => {
  it("normalizes and formats speed", () => {
    expect(normalizeSpeed(1.1)).toBe(1);
    expect(normalizeSpeed(9)).toBe(2);
    expect(normalizeSpeed(0.7)).toBe(0.75);
    expect(formatSpeed(1)).toBe("1.0x");
    expect(formatSpeed(0.75)).toBe("0.75x");
    expect(formatSpeed(2)).toBe("2.0x");
    expect(formatSpeed(1.5)).toBe("1.5x");
  });

  it("cycles loop all → one → off → all", () => {
    expect(nextLoopMode("all")).toBe("one");
    expect(nextLoopMode("one")).toBe("off");
    expect(nextLoopMode("off")).toBe("all");
  });

  it("bufferedEnd returns the range around the playhead, else the last end", () => {
    const ranges = (pairs: Array<[number, number]>) => ({
      length: pairs.length,
      start: (i: number) => (pairs[i] as [number, number])[0],
      end: (i: number) => (pairs[i] as [number, number])[1],
    });
    expect(bufferedEnd(ranges([]), 3)).toBe(0);
    expect(
      bufferedEnd(
        ranges([
          [0, 10],
          [20, 30],
        ]),
        5,
      ),
    ).toBe(10);
    expect(
      bufferedEnd(
        ranges([
          [0, 10],
          [20, 30],
        ]),
        25,
      ),
    ).toBe(30);
    expect(
      bufferedEnd(
        ranges([
          [0, 10],
          [20, 30],
        ]),
        15,
      ),
    ).toBe(30);
  });
});
