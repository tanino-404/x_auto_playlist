// Right-click "add to playlist" (docs/architecture.md §6.4, requirements F-03 / F-04).
// Remembers the element under the pointer on `contextmenu` (capture); when the service worker
// relays the menu click, resolves the post from the post cache and appends its media to the
// manual playlist. Never sends requests to X (design principle 7).

import { extractPostId, findArticle } from "@/lib/context-target/extract";
import { t } from "@/lib/i18n";
import type { PostCache } from "@/lib/post-cache";
import type { Store } from "@/lib/store";
import { UI_HOST_NAME } from "@/shared/constants";

export type AddResult =
  | { ok: true; postId: string; added: number }
  | { ok: false; reason: "no-target" | "no-post-id" | "not-cached" | "no-media" };

export interface ContextTarget {
  addFromLastTarget(position: "end" | "next"): AddResult;
  /** Overrides the remembered element (debug hooks / tests). */
  setLastTarget(target: Element | null): void;
  dispose(): void;
}

/** Toast texts, in the UI language at the time they are shown (F-60). */
export const CONTEXT_MESSAGES = {
  addedToEnd: (count: number) => t("toast.context.addedToEnd", { count }),
  addedNext: (count: number) => t("toast.context.addedNext", { count }),
  alreadyListed: () => t("toast.context.alreadyListed"),
  notCached: () => t("toast.context.notCached"),
  noMedia: () => t("toast.context.noMedia"),
  noTarget: () => t("toast.context.noTarget"),
} as const;

function isOwnUi(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element && node.tagName.toLowerCase() === UI_HOST_NAME.toLowerCase(),
    );
}

function toElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

export function createContextTarget(deps: { store: Store; postCache: PostCache }): ContextTarget {
  const { store, postCache } = deps;
  let lastTarget: Element | null = null;

  const onContextMenu = (event: MouseEvent) => {
    // Right-clicks inside our own Shadow DOM UI never point at a post.
    lastTarget = isOwnUi(event) ? null : toElement(event.target);
  };
  document.addEventListener("contextmenu", onContextMenu, true);

  const fail = (reason: Extract<AddResult, { ok: false }>["reason"]): AddResult => {
    const text =
      reason === "no-media"
        ? CONTEXT_MESSAGES.noMedia()
        : reason === "not-cached"
          ? CONTEXT_MESSAGES.notCached()
          : CONTEXT_MESSAGES.noTarget();
    store.setNotice({ kind: "error", text });
    return { ok: false, reason };
  };

  return {
    addFromLastTarget(position) {
      if (lastTarget === null || !lastTarget.isConnected) {
        return fail("no-target");
      }
      const article = findArticle(lastTarget);
      const postId = article === null ? null : extractPostId(article);
      if (postId === null) {
        return fail("no-post-id");
      }
      const post = postCache.get(postId);
      if (post === undefined) {
        return fail("not-cached");
      }
      const includeImages = store.settings.peek().includeImages;
      const items = post.items.filter((item) => includeImages || item.kind !== "photo");
      if (items.length === 0) {
        return fail("no-media");
      }
      const before = store.playlist.peek().manual.items.length;
      // Manual list regardless of mode (auto-mode playback order is not affected).
      store.addItems(items, "manual", position);
      const added = store.playlist.peek().manual.items.length - before;
      store.setNotice({
        kind: "info",
        text:
          added === 0
            ? CONTEXT_MESSAGES.alreadyListed()
            : position === "next"
              ? CONTEXT_MESSAGES.addedNext(added)
              : CONTEXT_MESSAGES.addedToEnd(added),
      });
      return { ok: true, postId, added };
    },
    setLastTarget(target) {
      lastTarget = target;
    },
    dispose() {
      document.removeEventListener("contextmenu", onContextMenu, true);
      lastTarget = null;
    },
  };
}
