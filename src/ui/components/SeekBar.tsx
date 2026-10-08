// Seek bar: buffered range (faint), played range (--xap-accent), hover time tooltip,
// click / drag to seek. With `disabled` it is a read-only progress bar.
import { useRef, useState } from "preact/hooks";
import { formatTime } from "@/lib/player/logic";
import { SEEK_STEP_SECONDS } from "@/shared/constants";
import "@/ui/components/components.css";

export interface SeekBarProps {
  current: number;
  duration: number;
  buffered: number;
  onSeek: (seconds: number) => void;
  /** aria-label. */
  label?: string;
  disabled?: boolean;
}

function ratioOf(value: number, total: number): number {
  return total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
}

export function SeekBar({
  current,
  duration,
  buffered,
  onSeek,
  label = "シークバー",
  disabled = false,
}: SeekBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragPointer = useRef<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const ratioAt = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) {
      return 0;
    }
    const rect = bar.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  };

  const canSeek = !disabled && duration > 0;

  const onPointerDown = (event: PointerEvent) => {
    if (!canSeek || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragPointer.current = event.pointerId;
    const ratio = ratioAt(event.clientX);
    setDragRatio(ratio);
    onSeek(ratio * duration);
  };
  const onPointerMove = (event: PointerEvent) => {
    const ratio = ratioAt(event.clientX);
    setHoverRatio(ratio);
    if (dragPointer.current === event.pointerId) {
      setDragRatio(ratio);
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
    const ratio = ratioAt(event.clientX);
    setDragRatio(null);
    onSeek(ratio * duration);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!canSeek) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "ArrowRight" ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS;
      onSeek(Math.min(duration, Math.max(0, current + delta)));
    }
  };

  const played = dragRatio ?? ratioOf(current, duration);
  const loaded = ratioOf(buffered, duration);

  return (
    <div
      ref={barRef}
      class="xap-seek"
      data-disabled={canSeek ? "false" : "true"}
      role="slider"
      tabIndex={canSeek ? 0 : -1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      aria-valuetext={`${formatTime(current)} / ${formatTime(duration)}`}
      aria-disabled={!canSeek}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHoverRatio(null)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div class="xap-seek__track">
        <div class="xap-seek__buffered" style={{ width: `${loaded * 100}%` }} />
        <div class="xap-seek__played" style={{ width: `${played * 100}%` }} />
      </div>
      {canSeek && <div class="xap-seek__thumb" style={{ left: `${played * 100}%` }} />}
      {canSeek && hoverRatio !== null && (
        <div class="xap-seek__tooltip" style={{ left: `${hoverRatio * 100}%` }}>
          {formatTime(hoverRatio * duration)}
        </div>
      )}
    </div>
  );
}
