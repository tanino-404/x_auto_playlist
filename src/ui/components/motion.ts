// Stage 9 motion helpers. Durations come from the --xap-dur / --xap-dur-slow tokens
// (tokens.css), which are 0ms under prefers-reduced-motion, so every exit / settle below
// finishes immediately there.
import { useEffect, useRef, useState } from "preact/hooks";

export type DurationToken = "--xap-dur" | "--xap-dur-slow";

/** A duration token's current value in ms ("120ms" / "0.12s"), or 0 when unavailable. */
export function readDurationMs(el: Element | null, token: DurationToken): number {
  if (el === null || typeof getComputedStyle !== "function") {
    return 0;
  }
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return raw.endsWith("ms") ? value : value * 1000;
}

export interface Presence {
  /** Render the element (true while shown and while its exit animation runs). */
  mounted: boolean;
  /** The element is on its way out: play the exit animation, ignore the pointer. */
  leaving: boolean;
}

/**
 * Keeps an element rendered for `exitMs()` after `show` turns false so it can animate out.
 * Showing it again while it is leaving cancels the exit.
 */
export function usePresence(show: boolean, exitMs: () => number): Presence {
  const [mounted, setMounted] = useState(show);
  const exitMsRef = useRef(exitMs);
  exitMsRef.current = exitMs;

  useEffect(() => {
    if (show) {
      if (!mounted) {
        setMounted(true);
      }
      return undefined;
    }
    if (!mounted) {
      return undefined;
    }
    const ms = exitMsRef.current();
    if (ms <= 0) {
      setMounted(false);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [show, mounted]);

  return { mounted: show || mounted, leaving: !show && mounted };
}
