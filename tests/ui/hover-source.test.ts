import { describe, expect, it } from "vitest";
import type { MediaSource, PlaylistItem } from "@/shared/types";
import { canHoverPreview, pickHoverSource } from "@/ui/panel/hover-source";

const mp4 = (url: string, bitrate?: number): MediaSource =>
  bitrate === undefined ? { url, mime: "video/mp4" } : { url, mime: "video/mp4", bitrate };

describe("pickHoverSource", () => {
  it("picks the lowest-bitrate mp4 regardless of order", () => {
    expect(
      pickHoverSource([mp4("mid", 832_000), mp4("low", 256_000), mp4("high", 2_176_000)]),
    ).toBe("low");
  });
  it("ignores HLS and image sources", () => {
    expect(
      pickHoverSource([
        { url: "hls", mime: "application/x-mpegURL" },
        mp4("high", 2_176_000),
        mp4("low", 632_000),
        { url: "img", mime: "image/jpeg" },
      ]),
    ).toBe("low");
  });
  it("prefers a known bitrate over a missing one", () => {
    expect(pickHoverSource([mp4("known", 950_000), mp4("unknown")])).toBe("known");
  });
  it("treats 0 (GIF mp4) as a valid bitrate", () => {
    expect(pickHoverSource([mp4("gif", 0)])).toBe("gif");
  });
  it("falls back to the last mp4 when no bitrate is known", () => {
    expect(pickHoverSource([mp4("first"), mp4("last")])).toBe("last");
  });
  it("returns null without an mp4", () => {
    expect(pickHoverSource([{ url: "hls", mime: "application/x-mpegURL" }])).toBeNull();
    expect(pickHoverSource([])).toBeNull();
  });
});

describe("canHoverPreview", () => {
  const base: PlaylistItem = {
    id: "1",
    kind: "video",
    postId: "1",
    postUrl: "https://x.com/u/status/1",
    author: { name: "u", screenName: "u", avatarUrl: "" },
    text: "",
    thumbnailUrl: "",
    sources: [mp4("low", 256_000)],
    playable: true,
    addedAt: 0,
  };
  it("is true for videos and gifs when enabled", () => {
    expect(canHoverPreview(base, true)).toBe(true);
    expect(canHoverPreview({ ...base, kind: "gif" }, true)).toBe(true);
  });
  it("is false when disabled, for photos, or without an mp4", () => {
    expect(canHoverPreview(base, false)).toBe(false);
    expect(
      canHoverPreview(
        { ...base, kind: "photo", sources: [{ url: "i", mime: "image/jpeg" }] },
        true,
      ),
    ).toBe(false);
    expect(canHoverPreview({ ...base, sources: [] }, true)).toBe(false);
  });
});
