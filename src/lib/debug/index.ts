// Development-only audit hooks (wired from x.content.ts behind import.meta.env.DEV).
// The page (e.g. Playwright's page.evaluate) talks to the ISOLATED world through DOM events:
//   document.dispatchEvent(new CustomEvent("x-auto-playlist:debug", { detail: {...} }))
// Replies to { action: "state" } and { action: "get-post", postId } come back as
// "x-auto-playlist:debug-state".
// Stage 3: { action: "player", command: "next" | "prev" | "pause" | "resume" | "seek" |
//   "set-volume" | "set-speed" | "cycle-loop" | "toggle-shuffle" | "set-quality", value? }
// and add-test-items accepts kind ("video" | "gif" | "photo") / playable / durationMs.
// Stage 4: { action: "context-add", position: "end" | "next", selector? } runs the right-click
//   add (with `selector`, document.querySelector(selector) is used as the right-clicked
//   element) and replies { action: "context-add", result: AddResult } as debug-state;
//   { action: "cache-put", post: ParsedPost } stores a post in the post cache.
//   "state" additionally reports scroller / notice / manual.
// Stage 5: "state" reports prefetch ({ nextId, ready }), videoCount (<video> elements in our
//   shadow root) and hotkeysEnabled; { action: "hotkey", key, code?, shiftKey? } dispatches a
//   synthetic keydown on document and replies { action: "hotkey", resolved, defaultPrevented }.
// Stage 8b (F-4C): "state" reports postActions ({ ready, pending[] }) and currentPost (the
//   playing item's post flags or null). { action: "post-action", postId, postAction:
//   "like" | "bookmark" | "repost" } runs postActions.toggle (sends a real request) and replies
//   { action: "post-action", result } as debug-state. { action: "learn-query-id", operation,
//   queryId } feeds learnQueryId. add-test-items accepts post: { favorited, bookmarked,
//   retweeted } and postId.

import type { ContextTarget } from "@/lib/context-target";
import { hotkeyContext, resolveHotkey } from "@/lib/hotkeys";
import type { Navigation } from "@/lib/navigation";
import type { Player } from "@/lib/player";
import type { PostAction, PostActions } from "@/lib/post-actions";
import type { PostCache } from "@/lib/post-cache";
import type { Scroller } from "@/lib/scroller";
import type { Store } from "@/lib/store";
import { UI_HOST_NAME } from "@/shared/constants";
import type {
  MediaKind,
  MediaSource,
  ParsedPost,
  PlaylistItem,
  PostFlags,
  Quality,
} from "@/shared/types";

export const DEBUG_EVENT = "x-auto-playlist:debug";
export const DEBUG_STATE_EVENT = "x-auto-playlist:debug-state";

interface TestItemInput {
  id: string;
  src: string;
  thumbnail?: string;
  author?: string;
  text?: string;
  kind?: MediaKind;
  playable?: boolean;
  durationMs?: number;
  /** F-4C: post id shared by several test items, and their like / bookmark / repost flags. */
  postId?: string;
  post?: Partial<PostFlags>;
  /** Extra mp4 sources (e.g. different resolutions) for quality tests. */
  sources?: Array<{ url: string; width?: number; height?: number; bitrate?: number }>;
}

function testSources(input: TestItemInput): MediaSource[] {
  if (input.kind === "photo") {
    return [{ url: input.src, mime: "image/jpeg" }];
  }
  const extra = Array.isArray(input.sources)
    ? input.sources
        .filter((source) => isRecord(source) && typeof source.url === "string")
        .map((source) => ({ ...source, mime: "video/mp4" as const }))
    : [];
  return extra.length > 0 ? extra : [{ url: input.src, mime: "video/mp4" }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTestItem(input: TestItemInput): PlaylistItem {
  const screenName = input.author ?? "debug";
  const kind: MediaKind = input.kind === "photo" || input.kind === "gif" ? input.kind : "video";
  return {
    id: input.id,
    kind,
    postId: typeof input.postId === "string" ? input.postId : input.id,
    postUrl: `https://x.com/${screenName}/status/${typeof input.postId === "string" ? input.postId : input.id}`,
    author: { name: screenName, screenName, avatarUrl: "" },
    text: input.text ?? "",
    thumbnailUrl: input.thumbnail ?? (kind === "photo" ? input.src : ""),
    ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
    sources: testSources(input),
    playable: input.playable !== false,
    addedAt: Date.now(),
    ...(isRecord(input.post)
      ? {
          post: {
            favorited: input.post.favorited === true,
            bookmarked: input.post.bookmarked === true,
            retweeted: input.post.retweeted === true,
          },
        }
      : {}),
  };
}

function parseTestItems(value: unknown): TestItemInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is TestItemInput =>
      isRecord(entry) && typeof entry.id === "string" && typeof entry.src === "string",
  );
}

function findPlayerWindowRect(): { x: number; y: number; width: number; height: number } | null {
  const host = document.querySelector(UI_HOST_NAME);
  const el = host?.shadowRoot?.querySelector(".xap-player");
  if (!el) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

interface DebugDeps {
  store: Store;
  player: Player;
  postCache: PostCache;
  navigation: Navigation;
  scroller: Scroller;
  contextTarget: ContextTarget;
  postActions: PostActions;
}

function parsePost(value: unknown): ParsedPost | null {
  if (!isRecord(value) || typeof value.postId !== "string" || !Array.isArray(value.items)) {
    return null;
  }
  return { postId: value.postId, items: value.items as PlaylistItem[] };
}

function collectState({ store, player, postCache, navigation, scroller, postActions }: DebugDeps) {
  const video = player.videoElement;
  const playback = store.playback.peek();
  return {
    playback: structuredClone(playback),
    currentTime: player.currentTime.peek(),
    duration: player.duration.peek(),
    buffered: player.buffered.peek(),
    loop: playback.loop,
    shuffle: playback.shuffle,
    speed: playback.speed,
    volume: playback.volume,
    muted: playback.muted,
    quality: playback.quality,
    resolvedQualityLabel: player.resolvedQualityLabel.peek(),
    kind: store.currentItem.peek()?.kind ?? null,
    awaitingMore: playback.awaitingMore,
    lastError: playback.lastError,
    controlsVisible: store.controlsVisible.peek(),
    visibleItemsLength: store.visibleItems.peek().length,
    mode: store.settings.peek().mode,
    fullscreen: player.fullscreen.peek(),
    fullscreenElement: document.fullscreenElement?.tagName.toLowerCase() ?? null,
    pictureInPicture: document.pictureInPictureElement !== null,
    video: video
      ? {
          currentTime: video.currentTime,
          paused: video.paused,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          src: video.currentSrc,
          muted: video.muted,
          volume: video.volume,
          playbackRate: video.playbackRate,
          loop: video.loop,
          hidden: video.hidden,
        }
      : null,
    image: player.imageElement
      ? { src: player.imageElement.currentSrc, hidden: player.imageElement.hidden }
      : null,
    windowRect: findPlayerWindowRect(),
    savedWindowRect: store.uiPrefs.peek().playerWindow,
    collectorStatus: store.collectorStatus.peek(),
    rateLimit: { ...store.rateLimit.peek() },
    page: { ...navigation.current.peek() },
    postCacheSize: postCache.size(),
    scroller: scroller.state.peek(),
    notice: store.notice.peek(),
    manual: {
      itemsLength: store.playlist.peek().manual.items.length,
      lastPlayedId: store.playlist.peek().manual.lastPlayedId,
    },
    prefetch: { ...player.prefetchState.peek() },
    videoCount:
      document.querySelector(UI_HOST_NAME)?.shadowRoot?.querySelectorAll("video").length ?? 0,
    hotkeysEnabled: store.settings.peek().hotkeys,
    postActions: {
      enabled: store.settings.peek().postActions,
      ready: postActions.ready.peek(),
      pending: [...postActions.pending.peek()],
    },
    currentPost: store.currentItem.peek()?.post ?? null,
  };
}

/** Dispatches a synthetic keydown on document and reports how the hotkeys resolved it. */
function dispatchHotkey(store: Store, detail: Record<string, unknown>) {
  const key = typeof detail.key === "string" ? detail.key : "";
  const init: KeyboardEventInit = {
    key,
    code: typeof detail.code === "string" ? detail.code : "",
    shiftKey: detail.shiftKey === true,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const event = new KeyboardEvent("keydown", init);
  // Resolved before dispatch: the action may change the state (e.g. currentId).
  const resolved = resolveHotkey(
    {
      key: init.key ?? "",
      code: init.code ?? "",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: init.shiftKey === true,
    },
    { ...hotkeyContext(store, null), editing: false },
  );
  document.dispatchEvent(event);
  return { action: "hotkey", key, resolved, defaultPrevented: event.defaultPrevented };
}

const POST_ACTIONS: readonly PostAction[] = ["like", "bookmark", "repost"];

const QUALITIES: readonly Quality[] = ["auto", "highest", "lowest"];

function runPlayerCommand(player: Player, command: unknown, value: unknown): void {
  const num = typeof value === "number" ? value : Number(value);
  switch (command) {
    case "next":
      player.next();
      break;
    case "prev":
      player.prev();
      break;
    case "pause":
      player.pause();
      break;
    case "resume":
      player.resume();
      break;
    case "seek":
      if (Number.isFinite(num)) {
        player.seek(num);
      }
      break;
    case "set-volume":
      if (Number.isFinite(num)) {
        player.setVolume(num);
      }
      break;
    case "set-speed":
      if (Number.isFinite(num)) {
        player.setSpeed(num);
      }
      break;
    case "cycle-loop":
      player.cycleLoop();
      break;
    case "toggle-shuffle":
      player.toggleShuffle();
      break;
    case "set-quality":
      if (QUALITIES.includes(value as Quality)) {
        player.setQuality(value as Quality);
      } else if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        player.setQuality({ height: Math.round(value) });
      } else {
        console.warn(
          "x-auto-playlist: set-quality expects auto | highest | lowest | <height>",
          value,
        );
      }
      break;
    default:
      console.warn("x-auto-playlist: unknown player command", command);
  }
}

export function installDebugHooks(deps: DebugDeps): void {
  const { store, player, postCache, contextTarget, postActions } = deps;

  document.addEventListener(DEBUG_EVENT, (event: Event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail)) {
      return;
    }
    switch (detail.action) {
      case "add-test-items": {
        const target = detail.target === "manual" ? "manual" : "auto";
        store.addItems(parseTestItems(detail.items).map(toTestItem), target);
        break;
      }
      case "play": {
        const id = typeof detail.id === "string" ? detail.id : store.visibleItems.peek()[0]?.id;
        if (id !== undefined) {
          void player.play(id);
        }
        break;
      }
      case "player": {
        runPlayerCommand(player, detail.command, detail.value);
        break;
      }
      case "state": {
        document.dispatchEvent(new CustomEvent(DEBUG_STATE_EVENT, { detail: collectState(deps) }));
        break;
      }
      case "get-post": {
        const postId = typeof detail.postId === "string" ? detail.postId : "";
        const post = postCache.get(postId);
        document.dispatchEvent(
          new CustomEvent(DEBUG_STATE_EVENT, {
            detail: { postId, post: post === undefined ? null : structuredClone(post) },
          }),
        );
        break;
      }
      case "context-add": {
        const position = detail.position === "next" ? "next" : "end";
        if (typeof detail.selector === "string") {
          contextTarget.setLastTarget(document.querySelector(detail.selector));
        }
        const result = contextTarget.addFromLastTarget(position);
        document.dispatchEvent(
          new CustomEvent(DEBUG_STATE_EVENT, { detail: { action: "context-add", result } }),
        );
        break;
      }
      case "cache-put": {
        const post = parsePost(detail.post);
        if (post === null) {
          console.warn("x-auto-playlist: cache-put expects { postId, items[] }", detail.post);
        } else {
          postCache.put(structuredClone(post));
        }
        break;
      }
      case "hotkey": {
        document.dispatchEvent(
          new CustomEvent(DEBUG_STATE_EVENT, { detail: dispatchHotkey(store, detail) }),
        );
        break;
      }
      case "post-action": {
        const postId = typeof detail.postId === "string" ? detail.postId : "";
        const action = detail.postAction;
        if (postId === "" || !POST_ACTIONS.includes(action as PostAction)) {
          console.warn("x-auto-playlist: post-action expects { postId, postAction }", detail);
          break;
        }
        void postActions.toggle(postId, action as PostAction).then((result) => {
          document.dispatchEvent(
            new CustomEvent(DEBUG_STATE_EVENT, { detail: { action: "post-action", result } }),
          );
        });
        break;
      }
      case "learn-query-id": {
        if (typeof detail.operation === "string" && typeof detail.queryId === "string") {
          postActions.learnQueryId(detail.operation, detail.queryId);
        }
        break;
      }
      default:
        console.warn("x-auto-playlist: unknown debug action", detail.action);
    }
  });

  console.info(`x-auto-playlist: debug hooks installed ("${DEBUG_EVENT}")`);
}
