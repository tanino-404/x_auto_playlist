// Floating player window (docs/architecture.md §7.2). Stage 3: title bar, video / photo
// area with media info, seek bar and the control row (prev / play-pause / next, time,
// volume, speed, quality, PiP, fullscreen, panel toggle). In fullscreen the chrome
// auto-hides.
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import type { Player } from "@/lib/player";
import { formatSpeed, formatTime, listResolutions } from "@/lib/player/logic";
import type { Store } from "@/lib/store";
import { PLAYER_WINDOW, SPEED_OPTIONS } from "@/shared/constants";
import type { Quality, QualityPreset } from "@/shared/types";
import { IconButton } from "@/ui/components/IconButton";
import {
  CloseIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  LoopIcon,
  NextIcon,
  PanelIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  PrevIcon,
  ShuffleIcon,
} from "@/ui/components/icons";
import { loopLabel, shuffleLabel } from "@/ui/components/labels";
import { Menu } from "@/ui/components/Menu";
import { SeekBar } from "@/ui/components/SeekBar";
import { VolumeControl } from "@/ui/components/VolumeControl";
import type { Rect, Viewport } from "@/ui/player-window/geometry";
import { clampRect, defaultRect } from "@/ui/player-window/geometry";
import { MediaInfo } from "@/ui/player-window/MediaInfo";
import "@/ui/player-window/player-window.css";

export interface PlayerWindowProps {
  store: Store;
  player: Player;
  /** The .xap-root element; fullscreen is requested on it so the panel stays visible. */
  rootRef: RefObject<HTMLElement>;
  /** Playback stopped: the window is fading out (App keeps it rendered until then). */
  leaving?: boolean;
}

type DragKind = "move" | "resize";

interface DragState {
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  startRect: Rect;
  /** Latest clamped rect, committed on pointerup. */
  latest: Rect | null;
}

/** Delay before a single click on the video toggles playback (a double click cancels it). */
const CLICK_DELAY_MS = 220;

const SPEED_MENU = SPEED_OPTIONS.map((value) => ({ value, label: formatSpeed(value) }));

const QUALITY_PRESET_LABELS: Record<QualityPreset, MessageKey> = {
  auto: "player.quality.auto",
  highest: "player.quality.highest",
  lowest: "player.quality.lowest",
};

/** Quality menu value: "auto" or an explicit resolution ("p"). */
type QualityMenuValue = "auto" | number;

/** "720" from "720p" (player.resolvedQualityLabel). */
function parseResolvedHeight(label: string | null): number | null {
  const height = label === null ? Number.NaN : Number.parseInt(label, 10);
  return Number.isFinite(height) && height > 0 ? height : null;
}

/**
 * F-45: "自動 · <playing>" plus every resolution the current item offers, highest first.
 * The checked entry is "auto", else the resolution actually playing (an explicit height the
 * item lacks falls back to the nearest one; the presets from S-10 map to what they chose).
 */
function qualityMenu(
  quality: Quality,
  resolutions: readonly number[],
  resolvedLabel: string | null,
): {
  options: { value: QualityMenuValue; label: string }[];
  value: QualityMenuValue;
  text: string;
} {
  const auto = t("player.quality.auto");
  const options: { value: QualityMenuValue; label: string }[] = [
    { value: "auto", label: resolvedLabel ? `${auto} · ${resolvedLabel}` : auto },
    ...resolutions.map((height) => ({ value: height, label: `${height}p` })),
  ];
  if (quality === "auto") {
    return { options, value: "auto", text: resolvedLabel ? `${auto} ${resolvedLabel}` : auto };
  }
  const resolved = parseResolvedHeight(resolvedLabel);
  const explicit = typeof quality === "object" ? quality.height : null;
  const value = resolved ?? explicit ?? -1;
  const text =
    typeof quality === "object"
      ? (resolvedLabel ?? `${quality.height}p`)
      : `${t(QUALITY_PRESET_LABELS[quality])}${resolvedLabel ? ` ${resolvedLabel}` : ""}`;
  return { options, value, text };
}

/** Layout viewport (excludes the page scrollbar, like the fixed-position panel). */
function readViewport(): Viewport {
  const root = document.documentElement;
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

function useViewport(): Viewport {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

/** While the pointer rests on these, the chrome stays visible. */
const CHROME_SELECTOR =
  ".xap-player__titlebar, .xap-player__bottom, .xap-info-sheet, .xap-menu__popup";

function isOverChrome(event: Event): boolean {
  const target = event.composedPath()[0];
  return target instanceof Element && target.closest(CHROME_SELECTOR) !== null;
}

/**
 * Fullscreen-only auto-hide: the timer starts when fullscreen is entered and restarts on
 * every real pointer movement; after PLAYER_WINDOW.controlsHideDelayMs the chrome (and the
 * cursor) hide unless the pointer rests on the chrome. pointermove events with unchanged
 * coordinates are ignored: Chrome emits them when the cursor style or the layout under a
 * stationary pointer changes, which would otherwise keep the chrome visible forever.
 * The result is mirrored into store.controlsVisible.
 */
function useAutoHide(store: Store, enabled: boolean, targetRef: RefObject<HTMLElement>) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    const el = targetRef.current;
    if (!enabled || !el) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let overChrome = false;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const schedule = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (!overChrome) {
          setHidden(true);
        }
      }, PLAYER_WINDOW.controlsHideDelayMs);
    };
    const onMove = (event: PointerEvent) => {
      if (event.clientX === lastX && event.clientY === lastY) {
        return;
      }
      lastX = event.clientX;
      lastY = event.clientY;
      overChrome = isOverChrome(event);
      setHidden(false);
      schedule();
    };
    const onDown = (event: PointerEvent) => {
      overChrome = isOverChrome(event);
      setHidden(false);
      schedule();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    schedule();
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [enabled, targetRef]);

  const visible = !(enabled && hidden);
  useEffect(() => {
    store.controlsVisible.value = visible;
  }, [store, visible]);
  useEffect(
    () => () => {
      store.controlsVisible.value = true;
    },
    [store],
  );
  return visible;
}

export function PlayerWindow({ store, player, rootRef, leaving = false }: PlayerWindowProps) {
  const mediaRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Rect while a drag is in progress; committed to uiPrefs on pointerup. */
  const [draftRect, setDraftRect] = useState<Rect | null>(null);
  const [expanded, setExpanded] = useState(false);
  const viewport = useViewport();

  useEffect(() => {
    const box = mediaRef.current;
    if (!box) {
      return undefined;
    }
    player.attach(box);
    return () => player.detach();
  }, [player]);

  useEffect(
    () => () => {
      if (clickTimer.current !== undefined) {
        clearTimeout(clickTimer.current);
      }
    },
    [],
  );

  const isFullscreen = player.fullscreen.value;
  const panelWidth = store.panelOpen.value ? store.uiPrefs.value.panelWidth : 0;
  const saved = store.uiPrefs.value.playerWindow;
  const floatingRect = clampRect(draftRect ?? saved ?? defaultRect(viewport, panelWidth), viewport);
  // Fullscreen: anchored with CSS (right = panel width) instead of computed from
  // window.innerWidth, which includes the page scrollbar while the fixed-position panel does
  // not. Both share the same containing block, so the window always ends at the panel edge
  // and follows panel resizes; with the panel closed it spans the whole width.
  const style = isFullscreen
    ? {
        left: "0px",
        top: "0px",
        bottom: "0px",
        right: `${panelWidth}px`,
        width: "auto",
        height: "auto",
      }
    : {
        left: `${floatingRect.x}px`,
        top: `${floatingRect.y}px`,
        width: `${floatingRect.width}px`,
        height: `${floatingRect.height}px`,
      };

  const playback = store.playback.value;
  const { status, volume, muted, speed, quality, awaitingMore, lastError, loop, shuffle } =
    playback;
  const item = store.currentItem.value;
  const itemId = item?.id ?? null;
  const timed = item !== null && (item.kind === "photo" || item.kind === "gif");
  const current = player.currentTime.value;
  const total = player.duration.value;
  const bufferedEnd = player.buffered.value;
  const resolvedLabel = player.resolvedQualityLabel.value;

  // Collapse the full-text sheet when the item changes.
  useEffect(() => {
    setExpanded(false);
  }, [itemId]);

  const controlsVisible = useAutoHide(store, isFullscreen, playerRef);

  const startDrag = (kind: DragKind) => (event: PointerEvent) => {
    if (isFullscreen || event.button !== 0) {
      return;
    }
    if (kind === "move" && (event.target as Element).closest("button")) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: floatingRect,
      latest: null,
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const start = drag.startRect;
    const next =
      drag.kind === "move"
        ? { ...start, x: start.x + dx, y: start.y + dy }
        : { ...start, width: start.width + dx, height: start.height + dy };
    drag.latest = clampRect(next, readViewport());
    setDraftRect(drag.latest);
  };

  const endDrag = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (drag.latest) {
      store.setPlayerWindowRect(drag.latest);
    }
    setDraftRect(null);
  };

  const onToggleFullscreen = () => {
    const root = rootRef.current;
    if (root) {
      void player.toggleFullscreen(root);
    }
  };

  const onClose = () => {
    if (player.isFullscreen()) {
      void document.exitFullscreen().catch(() => undefined);
    }
    player.stop();
  };

  /**
   * Only clicks on the <video> / <img> (the media area) toggle playback. Containment is
   * checked because a button that re-renders on click (e.g. "全文") is already detached
   * when the click bubbles to the stage, so ancestor checks on the target would fail.
   */
  const isMediaClick = (event: MouseEvent) => {
    const media = mediaRef.current;
    return media !== null && event.target instanceof Node && media.contains(event.target);
  };

  const onStageClick = (event: MouseEvent) => {
    if (!isMediaClick(event)) {
      return;
    }
    if (clickTimer.current !== undefined) {
      clearTimeout(clickTimer.current);
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = undefined;
      player.togglePlay();
    }, CLICK_DELAY_MS);
  };

  const onStageDblClick = (event: MouseEvent) => {
    if (!isMediaClick(event)) {
      return;
    }
    if (clickTimer.current !== undefined) {
      clearTimeout(clickTimer.current);
      clickTimer.current = undefined;
    }
    onToggleFullscreen();
  };

  const playing = status === "playing";
  const playLabel = playing ? t("transport.pause") : t("transport.play");
  const fullscreenLabel = isFullscreen ? t("player.fullscreen.exit") : t("player.fullscreen");
  // F-4F: the panel lives inside .xap-root (the fullscreen element), so it can be shown or
  // hidden without leaving fullscreen; the fullscreen rect above follows panelWidth.
  const panelOpen = store.panelOpen.value;
  const panelLabel = panelOpen ? t("player.panel.hide") : t("player.panel.show");
  const qualityMenuState = qualityMenu(
    quality,
    item !== null && item.kind !== "photo" ? listResolutions(item.sources) : [],
    resolvedLabel,
  );

  return (
    <div
      ref={playerRef}
      class={leaving ? "xap-player xap-player--leaving" : "xap-player"}
      data-fullscreen={isFullscreen ? "true" : "false"}
      data-controls-hidden={controlsVisible ? "false" : "true"}
      data-kind={item?.kind ?? "none"}
      style={style}
    >
      <div
        class="xap-player__titlebar"
        onPointerDown={startDrag("move")}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span class="xap-player__title">
          {item ? `@${item.author.screenName}` : "X Auto Playlist"}
        </span>
        <IconButton label={t("player.close")} onClick={onClose}>
          <CloseIcon size={16} />
        </IconButton>
      </div>

      {/* Mouse shortcuts only: the play and fullscreen buttons are the keyboard equivalents. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: see above. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above. */}
      <div class="xap-player__stage" onClick={onStageClick} onDblClick={onStageDblClick}>
        <div class="xap-player__media" ref={mediaRef} />
        {awaitingMore && <div class="xap-player__notice">{t("player.loadingNext")}</div>}
        {lastError !== null && (
          <div class="xap-player__error" role="status">
            {lastError}
          </div>
        )}
        {item !== null && (
          <MediaInfo item={item} expanded={expanded} onExpandedChange={setExpanded} />
        )}
      </div>

      <div class="xap-player__bottom">
        <div class="xap-player__seek-row">
          <SeekBar
            current={current}
            duration={total}
            buffered={bufferedEnd}
            onSeek={(seconds) => player.seek(seconds)}
            label={timed ? t("seek.displayTime") : t("seek.label")}
            disabled={timed}
          />
        </div>
        <div class="xap-player__controls">
          <IconButton label={t("transport.prev")} onClick={() => player.prev()}>
            <PrevIcon />
          </IconButton>
          <IconButton label={playLabel} onClick={() => player.togglePlay()}>
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </IconButton>
          <IconButton label={t("transport.next")} onClick={() => player.next()}>
            <NextIcon />
          </IconButton>
          <IconButton
            label={loopLabel(loop)}
            onClick={() => player.cycleLoop()}
            active={loop !== "off"}
            class="xap-player__loop-btn"
          >
            <LoopIcon one={loop === "one"} />
          </IconButton>
          <IconButton
            label={shuffleLabel()}
            onClick={() => player.toggleShuffle()}
            pressed={shuffle}
            class="xap-player__shuffle-btn"
          >
            <ShuffleIcon />
          </IconButton>
          <span class="xap-player__time">
            {formatTime(current)} / {formatTime(total)}
          </span>
          <span class="xap-player__spacer" />
          <VolumeControl
            volume={volume}
            muted={muted}
            onChange={(value) => player.setVolume(value)}
            onToggleMute={() => player.toggleMute()}
            showValue
            barWidth={56}
          />
          <Menu
            label={t("player.speed")}
            buttonText={formatSpeed(speed)}
            triggerClass="xap-player__speed"
            options={SPEED_MENU}
            value={speed}
            onSelect={(value) => player.setSpeed(value)}
          />
          <Menu
            label={t("player.quality")}
            buttonText={qualityMenuState.text}
            triggerClass="xap-player__quality"
            options={qualityMenuState.options}
            value={qualityMenuState.value}
            onSelect={(value) => player.setQuality(value === "auto" ? "auto" : { height: value })}
          />
          <IconButton
            label={t("player.pip")}
            onClick={() => void player.togglePictureInPicture()}
            disabled={item?.kind === "photo"}
            class="xap-player__pip-btn"
          >
            <PipIcon />
          </IconButton>
          <IconButton label={fullscreenLabel} onClick={onToggleFullscreen}>
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
          {/* A plain button (not IconButton) so it can carry data-xap-toggle-panel. */}
          <button
            type="button"
            class="xap-icon-btn xap-player__panel-btn"
            aria-label={panelLabel}
            title={panelLabel}
            aria-pressed={panelOpen}
            data-xap-toggle-panel="true"
            onClick={() => store.togglePanel()}
          >
            <PanelIcon filled={panelOpen} />
          </button>
        </div>
      </div>

      {!isFullscreen && (
        <div
          class="xap-player__resize-handle"
          onPointerDown={startDrag("resize")}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
    </div>
  );
}
