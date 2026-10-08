import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPlaylistItem,
  manualInsertAnchor,
  parseManualPlaylist,
  removeFromManual,
} from "@/lib/store/playlist";
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
    sources: [{ url: `https://video.twimg.com/${id}.mp4`, mime: "video/mp4" }],
    playable: true,
    addedAt: 0,
  };
}

const ids = (items: PlaylistItem[]) => items.map((item) => item.id);

describe("removeFromManual", () => {
  it("clears lastPlayedId when the last played item is removed", () => {
    const manual = { items: [makeItem("a"), makeItem("b")], lastPlayedId: "b" };
    expect(removeFromManual(manual, "b")).toEqual({ items: [makeItem("a")], lastPlayedId: null });
  });
  it("keeps lastPlayedId when another item is removed", () => {
    const manual = { items: [makeItem("a"), makeItem("b")], lastPlayedId: "b" };
    expect(removeFromManual(manual, "a").lastPlayedId).toBe("b");
  });
  it("returns the same object when nothing matches", () => {
    const manual = { items: [makeItem("a")], lastPlayedId: null };
    expect(removeFromManual(manual, "zz")).toBe(manual);
  });
});

describe("manualInsertAnchor", () => {
  const manual = { items: [makeItem("a"), makeItem("b")], lastPlayedId: "a" };
  it("uses the playing item when it is in the manual list", () => {
    expect(manualInsertAnchor(manual, "b")).toBe("b");
  });
  it("falls back to lastPlayedId (e.g. an auto item is playing)", () => {
    expect(manualInsertAnchor(manual, "auto-item")).toBe("a");
    expect(manualInsertAnchor(manual, null)).toBe("a");
  });
});

describe("parseManualPlaylist (restore validation)", () => {
  it("drops items that are not PlaylistItem-shaped", () => {
    const saved = {
      items: [
        makeItem("a"),
        { id: "b", sources: [] },
        { ...makeItem("c"), kind: "audio" },
        { ...makeItem("d"), author: null },
        { ...makeItem("e"), sources: [{ url: 1 }] },
        makeItem("f"),
      ],
      lastPlayedId: "f",
    };
    const parsed = parseManualPlaylist(saved);
    expect(ids(parsed.items)).toEqual(["a", "f"]);
    expect(parsed.lastPlayedId).toBe("f");
  });
  it("clears lastPlayedId that points at a dropped / missing item", () => {
    expect(parseManualPlaylist({ items: [makeItem("a")], lastPlayedId: "gone" }).lastPlayedId).toBe(
      null,
    );
  });
  it("isPlaylistItem accepts optional durationMs", () => {
    expect(isPlaylistItem({ ...makeItem("a"), durationMs: 1000 })).toBe(true);
    expect(isPlaylistItem({ ...makeItem("a"), durationMs: "1000" })).toBe(false);
  });
});

// Store-level behaviour with a stubbed chrome.storage.
describe("store manual playlist", () => {
  let session: Record<string, unknown>;

  beforeEach(() => {
    session = {};
    const area = (data: Record<string, unknown>) => ({
      get: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
      }),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(data, value);
      }),
    });
    vi.stubGlobal("chrome", { storage: { local: area({}), session: area(session) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function makeStore() {
    const { initStore } = await import("@/lib/store");
    return initStore();
  }

  it("restores a saved manual playlist, dropping malformed items", async () => {
    session.manualPlaylist = { items: [makeItem("a"), { id: "bad" }], lastPlayedId: "a" };
    const store = await makeStore();
    expect(ids(store.playlist.value.manual.items)).toEqual(["a"]);
    expect(store.playlist.value.manual.lastPlayedId).toBe("a");
  });

  it("removeItem clears lastPlayedId; clearPlaylist empties both", async () => {
    session.manualPlaylist = { items: [makeItem("a"), makeItem("b")], lastPlayedId: "b" };
    const store = await makeStore();
    store.updateSettings({ mode: "manual" });
    store.removeItem("b");
    expect(store.playlist.value.manual).toEqual({ items: [makeItem("a")], lastPlayedId: null });

    store.playlist.value = {
      ...store.playlist.value,
      manual: { ...store.playlist.value.manual, lastPlayedId: "a" },
    };
    store.clearPlaylist();
    expect(store.playlist.value.manual).toEqual({ items: [], lastPlayedId: null });
  });

  it("manual 'next' in auto mode inserts after lastPlayedId, not into the auto list", async () => {
    session.manualPlaylist = {
      items: [makeItem("a"), makeItem("b"), makeItem("c")],
      lastPlayedId: "a",
    };
    const store = await makeStore();
    store.addItems([makeItem("auto1")], "auto");
    store.updatePlayback({ currentId: "auto1", status: "playing" });
    store.addItems([makeItem("n")], "manual", "next");
    expect(ids(store.playlist.value.manual.items)).toEqual(["a", "n", "b", "c"]);
    expect(ids(store.playlist.value.auto.items)).toEqual(["auto1"]);
  });

  it("setNotice stamps the time", async () => {
    const store = await makeStore();
    store.setNotice({ kind: "info", text: "hi" });
    expect(store.notice.value).toMatchObject({ kind: "info", text: "hi" });
    expect(typeof store.notice.value?.at).toBe("number");
    store.setNotice(null);
    expect(store.notice.value).toBeNull();
  });
});
