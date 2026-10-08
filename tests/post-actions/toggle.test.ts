import { computed, signal } from "@preact/signals";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/lib/i18n";
import { createPostActions, type PostAction, type QueryIdStorage } from "@/lib/post-actions";
import type { Notice, PlaylistState, Store } from "@/lib/store";
import { applyPostFlags } from "@/lib/store/playlist";
import { QUERY_ID_CACHE_KEY, X_WEB_BEARER } from "@/shared/constants";
import type { PlaylistItem, PostFlags } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";

const IDS = {
  FavoriteTweet: "favQ",
  UnfavoriteTweet: "unfavQ",
  CreateBookmark: "bmQ",
  DeleteBookmark: "unbmQ",
  CreateRetweet: "rtQ",
  DeleteRetweet: "unrtQ",
};
const BUNDLE_URL = "https://abs.twimg.com/responsive-web/client-web/main.abc123.js";
const BUNDLE_SOURCE = Object.entries(IDS)
  .map(([op, id]) => `x(e){e.exports={queryId:"${id}",operationName:"${op}"}}`)
  .join(",");

function item(id: string, postId: string, post?: PostFlags): PlaylistItem {
  return {
    id,
    kind: "video",
    postId,
    postUrl: `https://x.com/u/status/${postId}`,
    author: { name: "u", screenName: "u", avatarUrl: "" },
    text: "",
    thumbnailUrl: "",
    sources: [],
    playable: true,
    addedAt: 0,
    ...(post ? { post } : {}),
  };
}

function fakeStore(initial: { auto?: PlaylistItem[]; manual?: PlaylistItem[] } = {}) {
  const settings = signal({ ...DEFAULT_SETTINGS });
  const playlist = signal<PlaylistState>({
    mode: "auto",
    auto: { pageKey: "home", items: initial.auto ?? [] },
    manual: { items: initial.manual ?? [], lastPlayedId: null },
  });
  const notices: Omit<Notice, "at">[] = [];
  const setPostFlags = vi.fn((postId: string, patch: Partial<PostFlags>) => {
    const current = playlist.peek();
    playlist.value = {
      ...current,
      auto: { ...current.auto, items: applyPostFlags(current.auto.items, postId, patch) },
      manual: { ...current.manual, items: applyPostFlags(current.manual.items, postId, patch) },
    };
  });
  const store = {
    settings,
    playlist,
    currentItem: computed(() => null),
    setPostFlags,
    setNotice: (notice: Omit<Notice, "at"> | null) => {
      if (notice !== null) {
        notices.push(notice);
      }
    },
  } as unknown as Store;
  return { store, settings, playlist, notices, setPostFlags };
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(
  opts: {
    respond?: (call: Call) => Response | Promise<Response>;
    csrf?: string | null;
    bundle?: string | null;
    store?: ReturnType<typeof fakeStore>;
    storage?: QueryIdStorage | null;
  } = {},
) {
  const calls: Call[] = [];
  const s = opts.store ?? fakeStore({ auto: [item("m1", "100"), item("m2", "100")] });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call = { url, init };
    calls.push(call);
    if (url === BUNDLE_URL) {
      return opts.bundle === null
        ? new Response("", { status: 404 })
        : new Response(opts.bundle ?? BUNDLE_SOURCE, { status: 200 });
    }
    return opts.respond ? opts.respond(call) : jsonResponse(200, { data: {} });
  }) as unknown as typeof fetch;
  const postActions = createPostActions({
    store: s.store,
    fetchImpl,
    getCsrfToken: () => (opts.csrf === undefined ? "csrf123" : opts.csrf),
    getBundleUrls: () => [BUNDLE_URL],
    storage: opts.storage ?? null,
    preloadDelayMs: -1,
    getLanguage: () => "ja-JP",
  });
  const mutations = () => calls.filter((call) => call.url.startsWith("https://x.com/"));
  return { ...s, calls, mutations, postActions };
}

// The expected notices below are the Japanese texts (F-60: language set explicitly).
beforeAll(() => initI18n({ settings: signal({ language: "ja" as const }) }));
afterAll(() => initI18n(null));

describe("postActions.toggle", () => {
  it("learns ids from the bundle and sends one well-formed FavoriteTweet", async () => {
    const t = setup();
    expect(t.postActions.ready.value).toBe(false);
    const result = await t.postActions.toggle("100", "like");
    expect(result).toEqual({ ok: true, action: "like", on: true });
    expect(t.postActions.ready.value).toBe(true);
    expect(t.mutations()).toHaveLength(1);
    const [call] = t.mutations();
    expect(call?.url).toBe("https://x.com/i/api/graphql/favQ/FavoriteTweet");
    expect(call?.init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        authorization: `Bearer ${X_WEB_BEARER}`,
        "x-csrf-token": "csrf123",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "ja",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      variables: { tweet_id: "100" },
      queryId: "favQ",
    });
  });

  it("updates every item of the post and shows a success notice", async () => {
    const s = fakeStore({
      auto: [item("a1", "100"), item("a2", "200")],
      manual: [item("b1", "100", { favorited: false, bookmarked: true, retweeted: false })],
    });
    const t = setup({ store: s });
    await t.postActions.toggle("100", "like");
    expect(t.setPostFlags).toHaveBeenCalledWith("100", { favorited: true });
    const all = [...s.playlist.value.auto.items, ...s.playlist.value.manual.items];
    expect(all.map((i) => [i.id, i.post])).toEqual([
      ["a1", { favorited: true, bookmarked: false, retweeted: false }],
      ["a2", undefined],
      ["b1", { favorited: true, bookmarked: true, retweeted: false }],
    ]);
    expect(t.notices).toEqual([{ kind: "info", text: "いいねしました" }]);
  });

  it.each<[PostAction, PostFlags, string, string, Record<string, unknown>, string]>([
    [
      "like",
      { favorited: true, bookmarked: false, retweeted: false },
      "unfavQ",
      "UnfavoriteTweet",
      { tweet_id: "100" },
      "いいねを取り消しました",
    ],
    [
      "bookmark",
      { favorited: false, bookmarked: false, retweeted: false },
      "bmQ",
      "CreateBookmark",
      { tweet_id: "100" },
      "ブックマークしました",
    ],
    [
      "bookmark",
      { favorited: false, bookmarked: true, retweeted: false },
      "unbmQ",
      "DeleteBookmark",
      { tweet_id: "100" },
      "ブックマークを解除しました",
    ],
    [
      "repost",
      { favorited: false, bookmarked: false, retweeted: false },
      "rtQ",
      "CreateRetweet",
      { tweet_id: "100", dark_request: false },
      "リポストしました",
    ],
    [
      "repost",
      { favorited: false, bookmarked: false, retweeted: true },
      "unrtQ",
      "DeleteRetweet",
      { tweet_id: "100", source_tweet_id: "100", dark_request: false },
      "リポストを取り消しました",
    ],
  ])("%s with %o → %s/%s", async (action, flags, queryId, operation, variables, text) => {
    const t = setup({ store: fakeStore({ auto: [item("m", "100", flags)] }) });
    const result = await t.postActions.toggle("100", action);
    expect(result.ok).toBe(true);
    const [call] = t.mutations();
    expect(call?.url).toBe(`https://x.com/i/api/graphql/${queryId}/${operation}`);
    expect(JSON.parse(String(call?.init?.body))).toEqual({ variables, queryId });
    expect(t.notices.at(-1)).toEqual({ kind: "info", text });
  });

  it("200 with errors → unknown, flags unchanged", async () => {
    const t = setup({
      respond: () => jsonResponse(200, { errors: [{ message: "x", code: 139 }] }),
    });
    const result = await t.postActions.toggle("100", "like");
    expect(result).toEqual({
      ok: false,
      action: "like",
      reason: "unknown",
      status: 200,
      code: 139,
    });
    expect(t.setPostFlags).not.toHaveBeenCalled();
    expect(t.notices).toEqual([
      { kind: "error", text: "いいねできませんでした（X がエラーを返しました）" },
    ]);
  });

  it.each([
    [401, "unauthorized", "いいねできませんでした（ログインが必要です）"],
    [403, "unauthorized", "いいねできませんでした（ログインが必要です）"],
    [429, "rate-limited", "いいねできませんでした（回数制限中です。しばらく待ってください）"],
    [500, "unknown", "いいねできませんでした（X がエラーを返しました）"],
  ] as const)("HTTP %i → %s", async (status, reason, text) => {
    const t = setup({ respond: () => jsonResponse(status, {}) });
    const result = await t.postActions.toggle("100", "like");
    expect(result).toEqual({ ok: false, action: "like", reason, status });
    expect(t.setPostFlags).not.toHaveBeenCalled();
    expect(t.notices).toEqual([{ kind: "error", text }]);
  });

  it("200 with error code 226 → automation-suspected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = setup({
      respond: () =>
        jsonResponse(200, {
          data: {},
          errors: [
            {
              message: "This request looks like it might be automated.",
              code: 226,
              kind: "Permissions",
              extensions: { code: 226, kind: "Permissions", name: "AuthorizationError" },
            },
          ],
        }),
    });
    const result = await t.postActions.toggle("100", "repost");
    expect(result).toEqual({
      ok: false,
      action: "repost",
      reason: "automation-suspected",
      status: 200,
      code: 226,
    });
    expect(t.setPostFlags).not.toHaveBeenCalled();
    expect(t.notices).toEqual([
      {
        kind: "error",
        text: "リポストできませんでした（X が自動操作と判定しました。しばらく時間を置いてください）",
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("This request looks like it might be automated."),
    );
    warn.mockRestore();
  });

  it("404 → X-side restriction notice; the query id is kept for the next press", async () => {
    const t = setup({ respond: () => new Response("", { status: 404 }) });
    const result = await t.postActions.toggle("100", "bookmark");
    expect(result).toEqual({ ok: false, action: "bookmark", reason: "unknown", status: 404 });
    expect(t.setPostFlags).not.toHaveBeenCalled();
    expect(t.notices).toEqual([
      {
        kind: "error",
        text: "ブックマークできませんでした（X 側の制限のため、この操作は現在使えません）",
      },
    ]);
    await t.postActions.toggle("100", "bookmark");
    // No re-scan of the bundle: the same query id is reused.
    expect(t.calls.map((c) => c.url)).toEqual([
      BUNDLE_URL,
      "https://x.com/i/api/graphql/bmQ/CreateBookmark",
      "https://x.com/i/api/graphql/bmQ/CreateBookmark",
    ]);
    expect(t.postActions.ready.value).toBe(true);
  });

  it("network error → network", async () => {
    const t = setup({
      respond: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await t.postActions.toggle("100", "bookmark")).toEqual({
      ok: false,
      action: "bookmark",
      reason: "network",
    });
    expect(t.notices).toEqual([
      { kind: "error", text: "ブックマークできませんでした（通信エラー）" },
    ]);
  });

  it("no ct0 cookie → unauthorized without sending anything", async () => {
    const t = setup({ csrf: null });
    expect(await t.postActions.toggle("100", "like")).toEqual({
      ok: false,
      action: "like",
      reason: "unauthorized",
    });
    expect(t.calls).toHaveLength(0);
  });

  it("query id unknown (bundle unreadable) → no-query-id without sending", async () => {
    const t = setup({ bundle: null });
    expect(await t.postActions.toggle("100", "repost")).toEqual({
      ok: false,
      action: "repost",
      reason: "no-query-id",
    });
    expect(t.mutations()).toHaveLength(0);
    expect(t.notices.at(-1)?.text).toBe(
      "リポストできませんでした（X の操作情報を取得できませんでした）",
    );
  });

  it("disabled in settings → disabled, nothing sent, no notice", async () => {
    const t = setup();
    t.settings.value = { ...t.settings.value, postActions: false };
    expect(await t.postActions.toggle("100", "like")).toEqual({
      ok: false,
      action: "like",
      reason: "disabled",
    });
    expect(t.calls).toHaveLength(0);
    expect(t.notices).toEqual([]);
  });

  it("ignores a second press while the first is in flight (one request per action)", async () => {
    let release: (response: Response) => void = () => undefined;
    const t = setup({
      respond: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    t.postActions.learnQueryId("FavoriteTweet", "obsQ");
    const first = t.postActions.toggle("100", "like");
    await vi.waitFor(() => expect(t.mutations()).toHaveLength(1));
    expect([...t.postActions.pending.value]).toEqual(["100:like"]);
    const second = await t.postActions.toggle("100", "like");
    expect(second.ok).toBe(false);
    expect(t.mutations()).toHaveLength(1);
    release(jsonResponse(200, { data: {} }));
    expect(await first).toEqual({ ok: true, action: "like", on: true });
    expect(t.postActions.pending.value.size).toBe(0);
    expect(t.notices).toEqual([{ kind: "info", text: "いいねしました" }]);
  });
});

describe("query id learning", () => {
  it("learnQueryId is used without scanning and wins over the bundle", async () => {
    const t = setup();
    t.postActions.learnQueryId("FavoriteTweet", "observed1");
    t.postActions.learnQueryId("HomeTimeline", "ignored");
    t.postActions.learnQueryId("CreateBookmark", "bad id!");
    await t.postActions.toggle("100", "like");
    expect(t.calls.map((c) => c.url)).toEqual([
      "https://x.com/i/api/graphql/observed1/FavoriteTweet",
    ]);
    // The bookmark id is missing, so the bundle is scanned; the observed like id must survive.
    await t.postActions.toggle("100", "bookmark");
    await t.postActions.toggle("100", "like"); // now on → unfavorite
    await t.postActions.toggle("200", "like");
    expect(t.mutations().map((c) => c.url)).toEqual([
      "https://x.com/i/api/graphql/observed1/FavoriteTweet",
      "https://x.com/i/api/graphql/bmQ/CreateBookmark",
      "https://x.com/i/api/graphql/unfavQ/UnfavoriteTweet",
      "https://x.com/i/api/graphql/observed1/FavoriteTweet",
    ]);
  });

  it("caches ids in session storage with the bundle URL and reuses them", async () => {
    const saved: Record<string, unknown> = {};
    const storage: QueryIdStorage = {
      get: async (key) => (key in saved ? { [key]: saved[key] } : {}),
      set: async (items) => {
        Object.assign(saved, items);
      },
    };
    const first = setup({ storage });
    await first.postActions.toggle("100", "like");
    expect(saved[QUERY_ID_CACHE_KEY]).toEqual({ bundleUrl: BUNDLE_URL, ids: IDS });

    const second = setup({ storage });
    await second.postActions.toggle("100", "like");
    expect(second.calls.map((c) => c.url)).toEqual([
      "https://x.com/i/api/graphql/favQ/FavoriteTweet",
    ]);
  });

  it("rescans when the cached bundle URL is no longer on the page", async () => {
    const storage: QueryIdStorage = {
      get: async () => ({
        [QUERY_ID_CACHE_KEY]: {
          bundleUrl: "https://abs.twimg.com/responsive-web/client-web/main.OLD.js",
          ids: { FavoriteTweet: "stale" },
        },
      }),
      set: async () => undefined,
    };
    const t = setup({ storage });
    await t.postActions.toggle("100", "like");
    expect(t.calls.map((c) => c.url)).toEqual([
      BUNDLE_URL,
      "https://x.com/i/api/graphql/favQ/FavoriteTweet",
    ]);
  });
});

describe("applyPostFlags", () => {
  it("patches every item of the post and returns the same array when none matches", () => {
    const items = [
      item("a", "1"),
      item("b", "2", { favorited: true, bookmarked: false, retweeted: false }),
    ];
    expect(applyPostFlags(items, "3", { favorited: true })).toBe(items);
    const next = applyPostFlags(items, "2", { retweeted: true });
    expect(next[0]).toBe(items[0]);
    expect(next[1]?.post).toEqual({ favorited: true, bookmarked: false, retweeted: true });
  });
});
