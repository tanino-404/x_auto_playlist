// Pure helpers for prefetching / double buffering (docs/architecture.md §6.3, S-12).
// Dependency-free for unit tests.

import type { NextDecision, NextInput, PrevDecision, PrevInput } from "@/lib/player/logic";
import { decideNext, decidePrev } from "@/lib/player/logic";
import type { MediaKind, Prefetch } from "@/shared/types";

/**
 * The "next" item decided ahead of time so that shuffle picks the item that was prefetched
 * (the random draw is made once and kept). Valid only while the current item is `fromId`
 * and shuffle / loop are unchanged.
 */
export interface NextPlan {
  fromId: string;
  shuffle: boolean;
  loop: NextInput["loop"];
  id: string | null;
  resetPlayed: boolean;
}

/**
 * The item the player would move to on "next" (reason "user", so loop "one" also yields the
 * following item — an automatic repeat reuses the element that is already loaded). In
 * shuffle, a still-valid `previous` plan is kept instead of drawing again.
 */
export function planNext(input: Omit<NextInput, "reason">, previous: NextPlan | null): NextPlan {
  const { currentId, shuffle, loop } = input;
  if (
    previous !== null &&
    shuffle &&
    previous.shuffle &&
    previous.loop === loop &&
    previous.fromId === currentId &&
    previous.id !== null &&
    previous.id !== currentId &&
    input.ids.includes(previous.id)
  ) {
    return previous;
  }
  const decision = decideNext({ ...input, reason: "user" });
  return { fromId: currentId ?? "", shuffle, loop, ...decision };
}

/**
 * decideNext(), but in shuffle a valid plan (see planNext) is used so the prefetched item is
 * the one that plays. Loop "one" with reason "auto" still repeats the current item.
 */
export function decideNextPlanned(input: NextInput, plan: NextPlan | null): NextDecision {
  const { ids, currentId, shuffle, loop, reason } = input;
  if (
    plan !== null &&
    shuffle &&
    plan.shuffle &&
    plan.loop === loop &&
    currentId !== null &&
    plan.fromId === currentId &&
    !(loop === "one" && reason === "auto") &&
    plan.id !== null &&
    plan.id !== currentId &&
    ids.includes(plan.id)
  ) {
    return { id: plan.id, resetPlayed: plan.resetPlayed };
  }
  return decideNext(input);
}

/**
 * decidePrev(), skipping items that cannot be played (same rule as "next"): keeps going back
 * until a playable item is found. When there is none, restarts the current item if it is
 * playable, else "none" (the caller stops with the "nothing playable" message).
 */
export function decidePrevSkipping(
  input: PrevInput,
  isPlayable: (id: string) => boolean,
): PrevDecision {
  const first = decidePrev(input);
  if (first.type !== "play" || isPlayable(first.id)) {
    return first;
  }
  const seen = new Set<string>([first.id]);
  if (input.currentId !== null) {
    seen.add(input.currentId);
  }
  let candidate = first.id;
  for (let i = 0; i <= input.ids.length; i++) {
    const decision = decidePrev({ ...input, currentId: candidate, currentTime: 0 });
    if (decision.type !== "play" || seen.has(decision.id)) {
      break;
    }
    if (isPlayable(decision.id)) {
      return decision;
    }
    seen.add(decision.id);
    candidate = decision.id;
  }
  return input.currentId !== null && isPlayable(input.currentId)
    ? { type: "restart" }
    : { type: "none" };
}

/** A prefetch candidate: the item and the URL that would be used to play it. */
export interface PrefetchCandidate {
  id: string;
  kind: MediaKind;
  /** mp4 selected with the playback quality (videos / GIFs) or the image URL (photos). */
  url: string;
}

export interface PrefetchTargets {
  /** What the spare <video> should load, or null to leave it empty. */
  video: { id: string; url: string; preload: "auto" | "metadata" } | null;
  /** Photos to warm up with new Image(). */
  images: Array<{ id: string; url: string }>;
  /** Id reported as prefetchState.nextId. */
  nextId: string | null;
}

/**
 * What to prefetch for setting S-12: "off" → nothing; "next" → the next item (video: spare
 * <video> with preload="auto"; photo: an Image); "both" → also the previous item, lightly
 * (video: preload="metadata", only when the spare <video> is not needed for the next item,
 * since at most two playback <video> elements exist). Candidates whose URL is already the
 * one on screen (`currentUrl`) are skipped.
 */
export function planPrefetch(
  setting: Prefetch,
  current: { id: string | null; url: string | null },
  next: PrefetchCandidate | null,
  prev: PrefetchCandidate | null,
): PrefetchTargets {
  const targets: PrefetchTargets = { video: null, images: [], nextId: null };
  if (setting === "off") {
    return targets;
  }
  const usable = (candidate: PrefetchCandidate | null): candidate is PrefetchCandidate =>
    candidate !== null &&
    candidate.id !== current.id &&
    candidate.url !== "" &&
    candidate.url !== current.url;
  if (usable(next)) {
    targets.nextId = next.id;
    if (next.kind === "photo") {
      targets.images.push({ id: next.id, url: next.url });
    } else {
      targets.video = { id: next.id, url: next.url, preload: "auto" };
    }
  }
  if (setting === "both" && usable(prev) && prev.id !== next?.id) {
    if (prev.kind === "photo") {
      targets.images.push({ id: prev.id, url: prev.url });
    } else if (targets.video === null) {
      targets.video = { id: prev.id, url: prev.url, preload: "metadata" };
    }
  }
  return targets;
}

/** True when the spare <video> already holds `url` and can be swapped in instead of loading. */
export function canUsePrefetched(spareSrc: string | null | undefined, url: string): boolean {
  return typeof spareSrc === "string" && spareSrc !== "" && spareSrc === url;
}
