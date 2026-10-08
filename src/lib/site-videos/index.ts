// Pauses x.com's own <video> elements while our player is playing (F-4A / S-15,
// docs/architecture.md §6.2). No MutationObserver: one capture-phase "play" listener on
// document ("play" does not bubble, but the capture phase still reaches document). Our own
// <video> elements live in the shadow root of the UI host and are excluded. X's videos are
// never resumed by us.

import { effect } from "@preact/signals";
import type { Store } from "@/lib/store";
import { UI_HOST_NAME } from "@/shared/constants";
import type { PlaybackStatus } from "@/shared/types";

export interface SiteVideoContext {
  /** settings.pauseSiteVideos */
  enabled: boolean;
  status: PlaybackStatus;
  /** The video belongs to our own UI (its event path passes through the x-auto-playlist host). */
  ours: boolean;
}

/** True when an x.com video that is (or starts) playing should be paused. Pure. */
export function shouldPauseSiteVideo(ctx: SiteVideoContext): boolean {
  return ctx.enabled && ctx.status === "playing" && !ctx.ours;
}

/** True when an event path (event.composedPath()) passes through our UI host. */
export function isOwnPath(path: readonly unknown[]): boolean {
  return path.some(
    (target) =>
      typeof target === "object" &&
      target !== null &&
      (target as { localName?: unknown }).localName === UI_HOST_NAME,
  );
}

const isVideo = (target: EventTarget | undefined): target is HTMLVideoElement =>
  typeof HTMLVideoElement !== "undefined" && target instanceof HTMLVideoElement;

export function createSiteVideoPauser(deps: { store: Store }): { dispose(): void } {
  const { store } = deps;

  const onPlay = (event: Event) => {
    const path = event.composedPath();
    const target = path[0];
    if (!isVideo(target)) {
      return;
    }
    const ctx: SiteVideoContext = {
      enabled: store.settings.peek().pauseSiteVideos,
      status: store.playback.peek().status,
      ours: isOwnPath(path),
    };
    if (shouldPauseSiteVideo(ctx)) {
      target.pause();
    }
  };
  document.addEventListener("play", onPlay, true);

  // When pausing becomes active, stop the site videos that are already playing.
  // document.querySelectorAll does not enter shadow roots, so our own videos are not listed.
  let wasActive = false;
  const disposeEffect = effect(() => {
    const { pauseSiteVideos } = store.settings.value;
    const { status } = store.playback.value;
    const active = shouldPauseSiteVideo({ enabled: pauseSiteVideos, status, ours: false });
    if (active && !wasActive) {
      for (const el of document.querySelectorAll("video")) {
        if (!el.paused) {
          el.pause();
        }
      }
    }
    wasActive = active;
  });

  return {
    dispose() {
      document.removeEventListener("play", onPlay, true);
      disposeEffect();
    },
  };
}
