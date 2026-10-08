// Pure helper for the thumbnail hover preview (F-23 / S-11).
import type { MediaSource, PlaylistItem } from "@/shared/types";

/**
 * The lowest-bitrate mp4 among `sources` (a missing bitrate counts as unknown / highest).
 * Ties go to the later entry, since sources are ordered high → low quality. Null when there
 * is no mp4 (HLS-only or photo).
 */
export function pickHoverSource(sources: readonly MediaSource[]): string | null {
  let best: MediaSource | null = null;
  let bestRate = Number.POSITIVE_INFINITY;
  for (const source of sources) {
    if (source.mime !== "video/mp4") {
      continue;
    }
    const rate = source.bitrate ?? Number.POSITIVE_INFINITY;
    if (best === null || rate <= bestRate) {
      best = source;
      bestRate = rate;
    }
  }
  return best?.url ?? null;
}

/** Whether hovering `item`'s thumbnail should start a preview. */
export function canHoverPreview(item: PlaylistItem, enabled: boolean): boolean {
  return enabled && item.kind !== "photo" && pickHoverSource(item.sources) !== null;
}
