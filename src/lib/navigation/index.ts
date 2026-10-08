// SPA navigation detection and page classification (docs/architecture.md §6.5).
// Runs in the ISOLATED world, so wrapping history.* here does not see X's own pushState calls
// (those happen in the MAIN world). The Navigation API events and popstate do reach us, and a
// light 1-second location poll covers anything else.

import type { ReadonlySignal } from "@preact/signals";
import { signal } from "@preact/signals";
import type { Store } from "@/lib/store";
import type { PageKind } from "@/shared/types";

// Development-only diagnostic logging; stripped from production builds.
const DEBUG = import.meta.env.DEV;

export interface PageInfo {
  kind: PageKind;
  /** kind + ":" + pathname (query and hash ignored). */
  key: string;
  url: string;
}

const POLL_INTERVAL_MS = 1000;

function pathnameOf(url: string): string {
  try {
    return new URL(url, "https://x.com").pathname;
  } catch {
    return "/";
  }
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * First path segments that are X's own pages, not user names (so `/explore` is not a profile).
 * Compared in lower case. Paths handled earlier in `classify` (home, i, search) are listed too
 * so the profile check stays safe on its own.
 */
const RESERVED_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "i",
  "search",
  "settings",
  "compose",
  "login",
  "logout",
  "signup",
  "about",
  "tos",
  "privacy",
  "jobs",
  "hashtag",
  "intent",
  "share",
  "account",
  "download",
  "lists",
  "communities",
  "bookmarks",
  "topics",
  "onboarding",
  "premium",
  "flow",
  "rules",
  "help",
  "following",
  "followers",
]);

/** X user names: 1-15 letters, digits or underscores. */
const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

function isScreenName(segment: string): boolean {
  return SCREEN_NAME_PATTERN.test(segment) && !RESERVED_FIRST_SEGMENTS.has(segment.toLowerCase());
}

function classify(segments: string[]): PageKind {
  const [first, second, third] = segments;
  if (first === undefined) {
    return "other";
  }
  if (segments.length === 1 && first === "home") {
    return "home";
  }
  if (first === "i" && second === "bookmarks") {
    return "bookmarks";
  }
  if (first === "i" && second === "history") {
    if (third === undefined || third === "bookmarks") {
      return "bookmarks";
    }
    if (third === "likes") {
      return "likes";
    }
    return "other";
  }
  if (first === "search") {
    return "search";
  }
  if (second === "status" && third !== undefined && /^\d+$/.test(third)) {
    return "status";
  }
  if (segments.length === 2 && first !== "i") {
    if (second === "likes") {
      return "likes";
    }
    if (second === "media") {
      return "user-media";
    }
  }
  // Profile tabs (F-61): /<user>, /<user>/with_replies, /<user>/reposts.
  if (isScreenName(first)) {
    if (segments.length === 1) {
      return "user-posts";
    }
    if (segments.length === 2 && second === "with_replies") {
      return "user-replies";
    }
    if (segments.length === 2 && second === "reposts") {
      return "user-reposts";
    }
  }
  return "other";
}

/** Pure: which page `url` is. */
export function getPageInfo(url: string): PageInfo {
  let pathname = normalizePath(pathnameOf(url));
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const kind = classify(segments);
  if (kind === "status") {
    // /<user>/status/<id>/photo/1 etc. are the same post.
    pathname = `/${segments.slice(0, 3).join("/")}`;
  }
  return { kind, key: `${kind}:${pathname}`, url };
}

/**
 * URLs X shows as an overlay on top of the current page (media viewer, composer). Moving to
 * one of them does not change the page underneath, so the auto playlist is kept.
 */
export function isOverlayUrl(url: string): boolean {
  const segments = normalizePath(pathnameOf(url))
    .split("/")
    .filter((segment) => segment !== "");
  if (segments[0] === "compose") {
    return true;
  }
  return (
    segments[1] === "status" &&
    (segments[3] === "photo" || segments[3] === "video") &&
    segments.length >= 4
  );
}

export interface Navigation {
  current: ReadonlySignal<PageInfo>;
  dispose(): void;
}

interface NavigationApiLike extends EventTarget {}

export function createNavigation(deps: { store: Pick<Store, "resetAutoPlaylist"> }): Navigation {
  const { store } = deps;
  const current = signal<PageInfo>(getPageInfo(location.href));
  let lastHref = location.href;
  store.resetAutoPlaylist(current.peek().key);

  const check = () => {
    const href = location.href;
    if (href === lastHref) {
      return;
    }
    lastHref = href;
    if (isOverlayUrl(href)) {
      return;
    }
    const next = getPageInfo(href);
    const previous = current.peek();
    if (next.key === previous.key) {
      if (next.url !== previous.url) {
        current.value = next;
      }
      return;
    }
    current.value = next;
    if (DEBUG) {
      console.debug(`[XAP] page ${previous.kind} -> ${next.kind} ${next.url}`);
    }
    // §6.5: the playing item keeps playing; only the auto list is rebuilt.
    store.resetAutoPlaylist(next.key);
  };
  const checkSoon = () => {
    // The URL is committed after the event handlers run.
    setTimeout(check, 0);
  };

  const cleanups: Array<() => void> = [];

  const navigationApi = (globalThis as { navigation?: NavigationApiLike }).navigation;
  if (navigationApi !== undefined && typeof navigationApi.addEventListener === "function") {
    navigationApi.addEventListener("navigatesuccess", check);
    navigationApi.addEventListener("navigate", checkSoon);
    cleanups.push(() => {
      navigationApi.removeEventListener("navigatesuccess", check);
      navigationApi.removeEventListener("navigate", checkSoon);
    });
  }

  window.addEventListener("popstate", checkSoon);
  cleanups.push(() => window.removeEventListener("popstate", checkSoon));

  // Insurance only (see the header comment).
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function pushState(this: History, ...args) {
    const result = originalPushState.apply(this, args);
    checkSoon();
    return result;
  };
  history.replaceState = function replaceState(this: History, ...args) {
    const result = originalReplaceState.apply(this, args);
    checkSoon();
    return result;
  };
  cleanups.push(() => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  });

  const timer = setInterval(check, POLL_INTERVAL_MS);
  cleanups.push(() => clearInterval(timer));

  return {
    current,
    dispose() {
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
    },
  };
}
