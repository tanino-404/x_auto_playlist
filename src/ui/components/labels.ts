// UI labels shared by the side panel and the player window (same aria-labels in both).
// Functions, so they are read in the current UI language at render time (F-60).
import { t } from "@/lib/i18n";
import type { LoopMode } from "@/shared/types";

export function loopLabel(loop: LoopMode): string {
  return t(`transport.loop.${loop}`);
}

export function shuffleLabel(): string {
  return t("transport.shuffle");
}
