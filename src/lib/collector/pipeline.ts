// Intercepted response → post cache / auto playlist (docs/architecture.md §6.1).
// Also watches collector health (requirements N-04): repeated "200 but nothing readable"
// responses mean X changed its JSON and the UI should say so.
//
// Replay buffer (docs/architecture.md §6.1, §6.5 bug fix): X sometimes fires the GraphQL
// request for the destination page (e.g. Likes/Bookmarks) *before* the URL actually changes
// (prefetch on click/hover). By the time the response arrives, navigation.current is still the
// previous page kind, so the normal page-kind check drops it — and the auto playlist stays
// empty until the next scroll. To cover that, non-matching responses are kept in a small ring
// buffer for a short time; when the page kind changes, buffered responses are re-checked
// against the new kind and appended if they now match.

import { effect } from "@preact/signals";
import { operationToPageKinds } from "@/lib/collector/page";
import { inspectTimelineResponse } from "@/lib/collector/parse";
import type { Navigation } from "@/lib/navigation";
import type { PostCache } from "@/lib/post-cache";
import type { Store } from "@/lib/store";
import { TARGET_OPERATIONS } from "@/shared/constants";
import type { InterceptedResponse } from "@/shared/messages";
import type { PageKind, ParsedPost, PlaylistItem, PlaylistMode, Settings } from "@/shared/types";

// Development-only diagnostic logging; stripped from production builds.
const DEBUG = import.meta.env.DEV;

/** Debug-only: logs one summary line per interpreted response. */
function logParsed(
  operation: string,
  postsCount: number,
  itemsCount: number,
  pageKind: PageKind,
  mode: PlaylistMode,
  appended: number | string,
): void {
  if (!DEBUG) {
    return;
  }
  console.debug(
    `[XAP] parsed ${operation} posts=${postsCount} items=${itemsCount} page=${pageKind} mode=${mode} appended=${appended}`,
  );
}

/** Consecutive unreadable 200 responses before the collector is reported as broken. */
export const BROKEN_THRESHOLD = 3;

/** How long a buffered response stays eligible for replay once the page kind changes. */
export const REPLAY_WINDOW_MS = 15_000;

/** Ring buffer size: oldest buffered response is dropped once this is exceeded. */
export const REPLAY_BUFFER_SIZE = 8;

export interface CollectorDeps {
  /** Only what the pipeline uses, so tests can pass a small fake. A full Store fits. */
  store: Pick<Store, "settings" | "addItems" | "setRateLimit" | "setCollectorStatus">;
  postCache: PostCache;
  navigation: Pick<Navigation, "current">;
}

const TARGETS: ReadonlySet<string> = new Set(TARGET_OPERATIONS);

/** Pure: whether a response for `operation` belongs on the current `pageKind` in auto mode. */
export function shouldAppendToAuto(
  operation: string,
  pageKind: PageKind,
  mode: PlaylistMode,
): boolean {
  return mode === "auto" && operationToPageKinds(operation).includes(pageKind);
}

/** Same filtering the normal path and the replay path both use (S-03 / requirements §5). */
function filterItems(
  posts: readonly ParsedPost[],
  settings: Pick<Settings, "includeImages">,
): PlaylistItem[] {
  const items: PlaylistItem[] = [];
  for (const post of posts) {
    for (const item of post.items) {
      if (item.kind === "photo" && !settings.includeImages) {
        continue;
      }
      items.push(item);
    }
  }
  return items;
}

interface BufferedResponse {
  operation: string;
  posts: ParsedPost[];
  receivedAt: number;
}

export function createCollectorPipeline(
  deps: CollectorDeps,
): (response: InterceptedResponse) => void {
  const { store, postCache, navigation } = deps;
  let consecutiveEmpty = 0;
  const buffer: BufferedResponse[] = [];

  function pushToBuffer(entry: BufferedResponse) {
    buffer.push(entry);
    while (buffer.length > REPLAY_BUFFER_SIZE) {
      buffer.shift();
    }
  }

  /** Re-checks buffered responses against the (new) page kind; consumes matches, drops stale ones. */
  function replayBuffer(pageKind: PageKind) {
    if (buffer.length === 0) {
      return;
    }
    const settings = store.settings.peek();
    const now = Date.now();
    const kept: BufferedResponse[] = [];
    for (const buffered of buffer) {
      if (now - buffered.receivedAt > REPLAY_WINDOW_MS) {
        continue; // too old: drop without adding.
      }
      if (shouldAppendToAuto(buffered.operation, pageKind, settings.mode)) {
        const items = filterItems(buffered.posts, settings);
        if (items.length > 0) {
          store.addItems(items, "auto");
          if (DEBUG) {
            console.debug(`[XAP] replayed ${buffered.operation} appended=${items.length}`);
          }
        }
        // consumed either way, so it is not replayed again on a later page change.
        continue;
      }
      kept.push(buffered);
    }
    buffer.length = 0;
    buffer.push(...kept);
  }

  effect(() => {
    replayBuffer(navigation.current.value.kind);
  });

  return (response) => {
    store.setRateLimit(response.rateLimit, response.status);
    if (response.body === null || response.body === undefined) {
      if (DEBUG) {
        const settings = store.settings.peek();
        const pageKind = navigation.current.peek().kind;
        logParsed(response.operation, 0, 0, pageKind, settings.mode, "skipped: no body");
      }
      return;
    }

    const receivedAt = response.receivedAt || Date.now();
    const inspection = inspectTimelineResponse(response.body, receivedAt);
    const posts = inspection.posts;

    // Health check. A timeline that only returned cursors (end of list) is not a failure.
    if (TARGETS.has(response.operation) && response.status === 200) {
      if (posts.length > 0) {
        consecutiveEmpty = 0;
        store.setCollectorStatus("ok");
      } else if (!inspection.instructionsFound || inspection.contentEntryCount > 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= BROKEN_THRESHOLD) {
          store.setCollectorStatus("broken");
        }
      }
    }

    for (const post of posts) {
      postCache.put(post);
    }

    const settings = store.settings.peek();
    if (settings.mode !== "auto") {
      const pageKind = navigation.current.peek().kind;
      logParsed(
        response.operation,
        posts.length,
        0,
        pageKind,
        settings.mode,
        "skipped: manual mode",
      );
      return;
    }
    const pageKind = navigation.current.peek().kind;
    if (!shouldAppendToAuto(response.operation, pageKind, settings.mode)) {
      // Might belong to the page X is navigating to (prefetched ahead of the URL change).
      // Only worth keeping if it targets a known page and actually carries something.
      if (posts.length > 0 && operationToPageKinds(response.operation).length > 0) {
        pushToBuffer({ operation: response.operation, posts, receivedAt });
        if (DEBUG) {
          console.debug(`[XAP] buffered ${response.operation}`);
        }
        logParsed(
          response.operation,
          posts.length,
          0,
          pageKind,
          settings.mode,
          "skipped: buffered for replay",
        );
        return;
      }
      logParsed(
        response.operation,
        posts.length,
        0,
        pageKind,
        settings.mode,
        "skipped: page mismatch",
      );
      return;
    }
    const items = filterItems(posts, settings);
    if (items.length > 0) {
      store.addItems(items, "auto");
      logParsed(
        response.operation,
        posts.length,
        items.length,
        pageKind,
        settings.mode,
        items.length,
      );
    } else {
      logParsed(
        response.operation,
        posts.length,
        items.length,
        pageKind,
        settings.mode,
        "skipped: no items",
      );
    }
  };
}
