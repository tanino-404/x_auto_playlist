// Like / bookmark / repost from the player window (F-4C, docs/architecture.md §6.8).
// The ONLY place this extension sends requests of its own to X (design principle 7 exception):
// exactly one mutation per user action, never retried automatically.

import type { ReadonlySignal } from "@preact/signals";
import { computed, signal } from "@preact/signals";
import {
  buildRequest,
  classifyResponse,
  clientLanguage,
  extractQueryIds,
  flagOf,
  hasAllQueryIds,
  isPostActionOperation,
  isValidQueryId,
  noticeText,
  operationFor,
  type PostAction,
  type PostActionResult,
  type QueryIds,
  readCsrfToken,
} from "@/lib/post-actions/logic";
import type { Store } from "@/lib/store";
import type { PostActionOperation } from "@/shared/constants";
import { POST_ACTION_OPERATIONS, QUERY_ID_CACHE_KEY } from "@/shared/constants";
import type { PlaylistItem, PostFlags } from "@/shared/types";

export type {
  PostAction,
  PostActionFailure,
  PostActionResult,
} from "@/lib/post-actions/logic";
export { extractQueryIds } from "@/lib/post-actions/logic";

export interface PostActions {
  toggle(postId: string, action: PostAction): Promise<PostActionResult>;
  learnQueryId(operation: string, queryId: string): void;
  /** True once the query ids of all six mutations are known. */
  ready: ReadonlySignal<boolean>;
  /** `${postId}:${action}` keys currently being sent (double-click guard). */
  pending: ReadonlySignal<Set<string>>;
  dispose(): void;
}

/** chrome.storage.session subset (injectable for tests). */
export interface QueryIdStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface PostActionsDeps {
  store: Store;
  fetchImpl?: typeof fetch;
  /** Defaults to the ct0 cookie of document.cookie. */
  getCsrfToken?: () => string | null;
  /** URLs of X's client bundles. Defaults to the page's abs.twimg.com client-web scripts. */
  getBundleUrls?: () => string[];
  /** Defaults to chrome.storage.session; null disables caching. */
  storage?: QueryIdStorage | null;
  /** Delay before the background bundle scan after start-up. Negative disables it. */
  preloadDelayMs?: number;
  /** Defaults to navigator.language. */
  getLanguage?: () => string | undefined;
}

interface CachedQueryIds {
  bundleUrl: string;
  ids: QueryIds;
}

const DEFAULT_PRELOAD_DELAY_MS = 5000;
const BUNDLE_SELECTOR = 'script[src*="abs.twimg.com/responsive-web/client-web/"]';

export function pendingKey(postId: string, action: PostAction): string {
  return `${postId}:${action}`;
}

function defaultBundleUrls(): string[] {
  try {
    return Array.from(document.querySelectorAll<HTMLScriptElement>(BUNDLE_SELECTOR))
      .map((script) => script.src)
      .filter((src) => src !== "");
  } catch {
    return [];
  }
}

/** main.*.js holds the GraphQL operation table; scan it first. */
function orderBundles(urls: string[]): string[] {
  const unique = [...new Set(urls)];
  const isMain = (url: string) => /\/main\.[^/]*\.js/.test(url);
  return [...unique.filter(isMain), ...unique.filter((url) => !isMain(url))];
}

function defaultStorage(): QueryIdStorage | null {
  try {
    const session = globalThis.chrome?.storage?.session;
    if (session === undefined) {
      return null;
    }
    return {
      get: (key) => session.get(key),
      set: (items) => session.set(items),
    };
  } catch {
    return null;
  }
}

function sanitizeIds(value: unknown): QueryIds {
  const ids: QueryIds = {};
  if (typeof value !== "object" || value === null) {
    return ids;
  }
  for (const operation of POST_ACTION_OPERATIONS) {
    const id = (value as Record<string, unknown>)[operation];
    if (typeof id === "string" && isValidQueryId(id)) {
      ids[operation] = id;
    }
  }
  return ids;
}

/** Current flags of `postId` from any item that knows them (playing item first). */
function findFlags(store: Store, postId: string): PostFlags | undefined {
  const { auto, manual } = store.playlist.peek();
  const candidates: (PlaylistItem | null)[] = [
    store.currentItem.peek(),
    ...auto.items,
    ...manual.items,
  ];
  for (const item of candidates) {
    if (item !== null && item.postId === postId && item.post !== undefined) {
      return item.post;
    }
  }
  return undefined;
}

export function createPostActions(deps: PostActionsDeps): PostActions {
  const { store } = deps;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const getCsrfToken =
    deps.getCsrfToken ??
    (() => {
      try {
        return readCsrfToken(document.cookie);
      } catch {
        return null;
      }
    });
  const getBundleUrls = deps.getBundleUrls ?? defaultBundleUrls;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const getLanguage =
    deps.getLanguage ??
    (() => {
      try {
        return navigator.language;
      } catch {
        return undefined;
      }
    });

  const ids = signal<QueryIds>({});
  const observed = new Set<PostActionOperation>();
  const pendingSet = signal<Set<string>>(new Set());
  const ready = computed(() => hasAllQueryIds(ids.value));
  let bundleUrl = "";
  let disposed = false;
  let scan: Promise<void> | null = null;
  let scannedKey: string | null = null;

  function persist(): void {
    if (storage === null) {
      return;
    }
    const cached: CachedQueryIds = { bundleUrl, ids: ids.peek() };
    storage.set({ [QUERY_ID_CACHE_KEY]: cached }).catch(() => undefined);
  }

  function merge(found: QueryIds): void {
    const next: QueryIds = { ...ids.peek() };
    let changed = false;
    for (const operation of POST_ACTION_OPERATIONS) {
      const id = found[operation];
      // An observed id is newer than anything read from a bundle or the cache.
      if (id === undefined || next[operation] === id || observed.has(operation)) {
        continue;
      }
      next[operation] = id;
      changed = true;
    }
    if (changed) {
      ids.value = next;
    }
  }

  const loadCache: Promise<void> = (async () => {
    if (storage === null) {
      return;
    }
    try {
      const stored = (await storage.get(QUERY_ID_CACHE_KEY))[QUERY_ID_CACHE_KEY];
      if (typeof stored !== "object" || stored === null) {
        return;
      }
      const cached = stored as Partial<CachedQueryIds>;
      const cachedUrl = typeof cached.bundleUrl === "string" ? cached.bundleUrl : "";
      // Reuse only while the page still loads the same bundle (ids change with each deploy).
      if (cachedUrl !== "" && getBundleUrls().includes(cachedUrl)) {
        bundleUrl = cachedUrl;
        merge(sanitizeIds(cached.ids));
      }
    } catch {
      // Ignore: the bundle scan fills the ids.
    }
  })();

  async function scanBundles(): Promise<void> {
    const urls = orderBundles(getBundleUrls());
    const key = urls.join("\n");
    if (scannedKey === key) {
      return; // This exact set of bundles was already scanned.
    }
    scannedKey = key;
    const found: QueryIds = {};
    let foundIn = "";
    for (const url of urls) {
      if (disposed || hasAllQueryIds(found)) {
        break;
      }
      try {
        const response = await fetchImpl(url, { credentials: "omit" });
        if (!response.ok) {
          continue;
        }
        const extracted = extractQueryIds(await response.text());
        for (const operation of POST_ACTION_OPERATIONS) {
          const id = extracted[operation];
          if (id !== undefined && found[operation] === undefined) {
            found[operation] = id;
            foundIn ||= url;
          }
        }
      } catch {
        // Try the next bundle.
      }
    }
    if (foundIn !== "") {
      bundleUrl = foundIn;
      merge(found);
      persist();
    }
  }

  /** Loads the cache, then scans the bundles while an id is still missing. Shared by callers. */
  function ensureQueryIds(): Promise<void> {
    if (scan === null) {
      scan = (async () => {
        await loadCache;
        if (!hasAllQueryIds(ids.peek())) {
          await scanBundles();
        }
      })().finally(() => {
        scan = null;
      });
    }
    return scan;
  }

  const preloadDelay = deps.preloadDelayMs ?? DEFAULT_PRELOAD_DELAY_MS;
  const preloadTimer =
    preloadDelay >= 0
      ? setTimeout(() => {
          void ensureQueryIds();
        }, preloadDelay)
      : null;

  function setPending(key: string, on: boolean): void {
    const next = new Set(pendingSet.peek());
    if (on) {
      next.add(key);
    } else {
      next.delete(key);
    }
    pendingSet.value = next;
  }

  function report(result: PostActionResult, on: boolean): PostActionResult {
    store.setNotice({ kind: result.ok ? "info" : "error", text: noticeText(result, on) });
    return result;
  }

  async function send(postId: string, action: PostAction, on: boolean): Promise<PostActionResult> {
    const operation = operationFor(action, on);
    const csrf = getCsrfToken();
    if (csrf === null) {
      return { ok: false, action, reason: "unauthorized" };
    }
    if (ids.peek()[operation] === undefined) {
      await ensureQueryIds();
    }
    const queryId = ids.peek()[operation];
    if (queryId === undefined) {
      return { ok: false, action, reason: "no-query-id" };
    }
    const request = buildRequest(operation, queryId, postId, csrf, clientLanguage(getLanguage()));
    let response: Response;
    try {
      response = await fetchImpl(request.url, request.init);
    } catch {
      return { ok: false, action, reason: "network" };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const verdict = classifyResponse(response.status, body);
    if (!verdict.ok) {
      // 404: X wants its own per-request signature header, which we cannot reproduce. The
      // query id itself is correct, so it is kept (no resend, no re-learning).
      if (verdict.message !== undefined) {
        console.warn(
          `x-auto-playlist: ${operation} failed (status ${verdict.status}, code ${verdict.code ?? "-"}): ${verdict.message}`,
        );
      }
      return {
        ok: false,
        action,
        reason: verdict.reason,
        status: verdict.status,
        ...(verdict.code !== undefined ? { code: verdict.code } : {}),
      };
    }
    store.setPostFlags(postId, { [flagOf(action)]: on });
    return { ok: true, action, on };
  }

  return {
    ready,
    pending: pendingSet,
    async toggle(postId, action) {
      if (!store.settings.peek().postActions) {
        return { ok: false, action, reason: "disabled" };
      }
      const key = pendingKey(postId, action);
      if (pendingSet.peek().has(key)) {
        // Double-click guard: one request per user action. The ignored press shows nothing.
        return { ok: false, action, reason: "unknown" };
      }
      const on = findFlags(store, postId)?.[flagOf(action)] !== true;
      setPending(key, true);
      try {
        return report(await send(postId, action, on), on);
      } catch {
        return report({ ok: false, action, reason: "unknown" }, on);
      } finally {
        setPending(key, false);
      }
    },
    learnQueryId(operation, queryId) {
      if (!isPostActionOperation(operation) || !isValidQueryId(queryId)) {
        return;
      }
      observed.add(operation);
      if (ids.peek()[operation] !== queryId) {
        ids.value = { ...ids.peek(), [operation]: queryId };
        persist();
      }
    },
    dispose() {
      disposed = true;
      if (preloadTimer !== null) {
        clearTimeout(preloadTimer);
      }
    },
  };
}
