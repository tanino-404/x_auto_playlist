// UI labels shared by the side panel and the player window (same aria-labels in both).
import type { LoopMode } from "@/shared/types";

export const LOOP_LABELS: Record<LoopMode, string> = {
  all: "ループ: すべて",
  one: "ループ: 1 件",
  off: "ループ: なし",
};

export const SHUFFLE_LABEL = "シャッフル";
