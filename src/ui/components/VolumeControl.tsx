// VLC-style volume (F-43): mute toggle icon + horizontal bar (+ optional "50%").
// Wheel over the control: ±VOLUME_STEP. Click / drag on the bar: that position. Keyboard:
// arrows ±VOLUME_STEP, Home / End.
import { useEffect, useRef } from "preact/hooks";
import { t } from "@/lib/i18n";
import { formatVolume, roundVolume } from "@/lib/player/logic";
import { VOLUME_STEP } from "@/shared/constants";
import { VolumeIcon } from "@/ui/components/icons";
import "@/ui/components/components.css";

export interface VolumeControlProps {
  volume: number;
  muted: boolean;
  onChange: (volume: number) => void;
  onToggleMute: () => void;
  /** Show the "50%" read-out (player window). */
  showValue?: boolean;
  /** Bar width in px. */
  barWidth?: number;
}

export function VolumeControl({
  volume,
  muted,
  onChange,
  onToggleMute,
  showValue = false,
  barWidth = 72,
}: VolumeControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragPointer = useRef<number | null>(null);
  // Handlers attached with addEventListener read the latest props through this ref.
  const latest = useRef({ volume, onChange });
  latest.current = { volume, onChange };

  // wheel must be non-passive to preventDefault (Preact's onWheel may be passive).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? 1 : -1;
      const { volume: current, onChange: change } = latest.current;
      change(roundVolume(current + direction * VOLUME_STEP));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  const valueAt = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) {
      return volume;
    }
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) {
      return volume;
    }
    return roundVolume((clientX - rect.left) / rect.width);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragPointer.current = event.pointerId;
    onChange(valueAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dragPointer.current !== event.pointerId) {
      return;
    }
    const next = valueAt(event.clientX);
    if (next !== latest.current.volume) {
      onChange(next);
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (dragPointer.current !== event.pointerId) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    dragPointer.current = null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = volume + VOLUME_STEP;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = volume - VOLUME_STEP;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = 1;
    }
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      onChange(roundVolume(next));
    }
  };

  const percent = Math.round(roundVolume(volume) * 100);
  const level = muted || percent === 0 ? "mute" : percent < 50 ? "low" : "high";

  return (
    <div class="xap-volume" ref={rootRef} data-muted={muted ? "true" : "false"}>
      <button
        type="button"
        class="xap-icon-btn"
        aria-label={muted ? t("volume.unmute") : t("volume.mute")}
        title={muted ? t("volume.unmute") : t("volume.mute")}
        aria-pressed={muted}
        onClick={(event) => {
          event.stopPropagation();
          onToggleMute();
        }}
      >
        <VolumeIcon level={level} />
      </button>
      <div
        ref={barRef}
        class="xap-volume__bar"
        style={{ width: `${barWidth}px` }}
        role="slider"
        tabIndex={0}
        aria-label={t("volume.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={formatVolume(volume)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div class="xap-volume__track">
          <div class="xap-volume__fill" style={{ width: `${percent}%` }} />
        </div>
        <div class="xap-volume__thumb" style={{ left: `${percent}%` }} />
      </div>
      {showValue && <span class="xap-volume__value">{percent}%</span>}
    </div>
  );
}
