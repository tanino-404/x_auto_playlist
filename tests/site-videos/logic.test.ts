import { describe, expect, it } from "vitest";
import { isOwnPath, shouldPauseSiteVideo } from "@/lib/site-videos";
import { UI_HOST_NAME } from "@/shared/constants";

describe("shouldPauseSiteVideo", () => {
  it("pauses x.com videos while enabled and playing", () => {
    expect(shouldPauseSiteVideo({ enabled: true, status: "playing", ours: false })).toBe(true);
  });

  it("does nothing while paused / idle", () => {
    expect(shouldPauseSiteVideo({ enabled: true, status: "paused", ours: false })).toBe(false);
    expect(shouldPauseSiteVideo({ enabled: true, status: "idle", ours: false })).toBe(false);
  });

  it("does nothing when the setting is off", () => {
    expect(shouldPauseSiteVideo({ enabled: false, status: "playing", ours: false })).toBe(false);
  });

  it("never pauses our own videos", () => {
    expect(shouldPauseSiteVideo({ enabled: true, status: "playing", ours: true })).toBe(false);
  });
});

describe("isOwnPath", () => {
  it("detects our UI host in the event path", () => {
    expect(isOwnPath([{ localName: "video" }, { localName: UI_HOST_NAME }, {}])).toBe(true);
    expect(isOwnPath([{ localName: "video" }, { localName: "div" }, null])).toBe(false);
    expect(isOwnPath([])).toBe(false);
  });
});
