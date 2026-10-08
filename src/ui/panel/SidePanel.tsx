// The side panel overlay (docs/architecture.md §7.1). Header (title / mode / settings /
// close), the transport row (prev / play-pause / next / loop / shuffle / volume / position),
// status banners, the list (PlaylistList) or the settings screen (stage 6), the toast and the
// footer (count + 空にする).
import { useEffect, useRef, useState } from "preact/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import type { Player } from "@/lib/player";
import type { Store } from "@/lib/store";
import type { PlaylistMode } from "@/shared/types";
import { IconButton } from "@/ui/components/IconButton";
import {
  AppMarkIcon,
  CloseIcon,
  LoopIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  SettingsIcon,
  ShuffleIcon,
} from "@/ui/components/icons";
import { loopLabel, shuffleLabel } from "@/ui/components/labels";
import { readDurationMs } from "@/ui/components/motion";
import { Toast } from "@/ui/components/Toast";
import { VolumeControl } from "@/ui/components/VolumeControl";
import { PlaylistList } from "@/ui/panel/PlaylistList";
import { SettingsView } from "@/ui/settings/SettingsView";
import "@/ui/panel/panel.css";

export interface SidePanelProps {
  store: Store;
  player: Player;
  /** The panel was closed and is sliding out (App keeps it rendered until then). */
  leaving?: boolean;
}

const MODES: ReadonlyArray<{ value: PlaylistMode; label: MessageKey }> = [
  { value: "auto", label: "panel.mode.auto" },
  { value: "manual", label: "panel.mode.manual" },
];

/**
 * Item the play button starts from when nothing is playing (F-17 / F-52): the selection,
 * else (manual mode) the last played item if still listed, else the first item.
 */
function startIdForPlayButton(store: Store): string | undefined {
  const items = store.visibleItems.peek();
  const { selectedId } = store.playback.peek();
  if (selectedId !== null && items.some((item) => item.id === selectedId)) {
    return selectedId;
  }
  if (store.settings.peek().mode === "manual") {
    const last = store.playlist.peek().manual.lastPlayedId;
    if (last !== null && items.some((item) => item.id === last)) {
      return last;
    }
  }
  return items[0]?.id;
}

/** ⏮ ⏯ ⏭  🔁 🔀  volume  "3 / 27" */
function Transport({ store, player }: Pick<SidePanelProps, "store" | "player">) {
  const { status, loop, shuffle, volume, muted, currentId } = store.playback.value;
  const items = store.visibleItems.value;
  const count = items.length;
  const index = currentId === null ? -1 : items.findIndex((item) => item.id === currentId);
  const hasCurrent = currentId !== null;
  const playing = status === "playing";

  // F-16/F-17: from idle, playback only starts from this button or a row double-click.
  const onPlayPause = () => {
    if (status === "playing") {
      player.pause();
    } else if (status === "paused") {
      player.resume();
    } else {
      const id = startIdForPlayButton(store);
      if (id !== undefined) {
        void player.play(id);
      }
    }
  };

  return (
    <div class="xap-panel__transport">
      <IconButton label={t("transport.prev")} onClick={() => player.prev()} disabled={!hasCurrent}>
        <PrevIcon />
      </IconButton>
      <IconButton
        label={playing ? t("transport.pause") : t("transport.play")}
        onClick={onPlayPause}
        disabled={!playing && status !== "paused" && count === 0}
        class="xap-panel__play-btn"
      >
        {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
      </IconButton>
      <IconButton label={t("transport.next")} onClick={() => player.next()} disabled={!hasCurrent}>
        <NextIcon />
      </IconButton>
      <span class="xap-panel__transport-gap" />
      <IconButton
        label={loopLabel(loop)}
        onClick={() => player.cycleLoop()}
        active={loop !== "off"}
      >
        <LoopIcon one={loop === "one"} />
      </IconButton>
      <IconButton label={shuffleLabel()} onClick={() => player.toggleShuffle()} pressed={shuffle}>
        <ShuffleIcon />
      </IconButton>
      <span class="xap-panel__transport-gap" />
      <VolumeControl
        volume={volume}
        muted={muted}
        onChange={(value) => player.setVolume(value)}
        onToggleMute={() => player.toggleMute()}
        barWidth={56}
      />
      <span class="xap-panel__position" aria-live="off">
        {index === -1 ? t("panel.count", { count }) : `${index + 1} / ${count}`}
      </span>
    </div>
  );
}

/** True while `until` (epoch ms) is in the future; re-renders when it passes. */
function useIsFuture(until: number | null): boolean {
  const [, setTick] = useState(0);
  const future = until !== null && until > Date.now();
  useEffect(() => {
    if (until === null) {
      return;
    }
    const wait = until - Date.now();
    if (wait <= 0) {
      return;
    }
    const timer = setTimeout(() => setTick((tick) => tick + 1), wait + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return future;
}

/** Collector health (N-04) and rate-limit notices, shown above the list. */
function StatusBanners({ store }: { store: Store }) {
  const broken = store.collectorStatus.value === "broken";
  const limited = useIsFuture(store.rateLimit.value.limitedUntil);
  if (!broken && !limited) {
    return null;
  }
  return (
    <div class="xap-panel__banners">
      {broken && (
        <p class="xap-panel__banner" data-tone="danger" role="alert">
          {t("panel.banner.broken")}
        </p>
      )}
      {limited && (
        <p class="xap-panel__banner" data-tone="muted" role="status">
          {t("panel.banner.rateLimited")}
        </p>
      )}
    </div>
  );
}

export function SidePanel({ store, player, leaving = false }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const width = store.uiPrefs.value.panelWidth;
  const mode = store.settings.value.mode;
  const itemCount = store.itemCount.value;
  const [view, setView] = useState<"list" | "settings">("list");
  // Opening: the panel box takes its width at once (the split-view document shrinks without a
  // transition, see src/lib/layout) and only its contents slide in. Later list <-> settings
  // switches just fade the incoming view.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const timer = setTimeout(
      () => setEntering(false),
      readDurationMs(panelRef.current, "--xap-dur-slow") + 40,
    );
    return () => clearTimeout(timer);
  }, []);

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: store.uiPrefs.value.panelWidth,
    };
    // The handle lives outside our Shadow DOM (it's positioned against the whole page), so
    // prevent x.com's own text/selection from being dragged along with the divider.
    document.documentElement.style.userSelect = "none";
  };

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    // The handle sits on the panel's left edge and the panel is pinned to the
    // screen's right edge, so moving the pointer left widens the panel.
    const delta = drag.startX - event.clientX;
    store.setPanelWidth(drag.startWidth + delta);
  };

  const handlePointerUp = (event: PointerEvent) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    target.releasePointerCapture(event.pointerId);
    dragState.current = null;
    document.documentElement.style.removeProperty("user-select");
  };

  return (
    <div
      ref={panelRef}
      class={`xap-panel${entering ? " xap-panel--entering" : ""}${leaving ? " xap-panel--leaving" : ""}`}
      style={{ width: `${width}px` }}
    >
      <div
        class="xap-panel__resize-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <header class="xap-panel__header">
        <span class="xap-panel__brand">
          <AppMarkIcon size={20} />
          <span class="xap-panel__title">X Auto Playlist</span>
        </span>
        <fieldset class="xap-panel__mode" aria-label={t("panel.mode.label")}>
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              class="xap-panel__mode-btn"
              aria-pressed={mode === item.value}
              onClick={() => store.updateSettings({ mode: item.value })}
            >
              {t(item.label)}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          class="xap-panel__icon-btn"
          aria-label={t("panel.settings")}
          title={t("panel.settings")}
          aria-pressed={view === "settings"}
          onClick={() => setView(view === "settings" ? "list" : "settings")}
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          class="xap-panel__icon-btn"
          aria-label={t("panel.close")}
          title={t("panel.close")}
          onClick={() => store.setPanelOpen(false)}
        >
          <CloseIcon />
        </button>
      </header>

      <Transport store={store} player={player} />

      {view === "settings" ? (
        <SettingsView store={store} onBack={() => setView("list")} />
      ) : (
        <>
          <StatusBanners store={store} />
          <div class="xap-panel__body" data-empty={itemCount === 0 ? "true" : "false"}>
            {itemCount === 0 ? (
              <p class="xap-panel__empty">{t("panel.empty")}</p>
            ) : (
              <PlaylistList store={store} player={player} />
            )}
          </div>
        </>
      )}

      <Toast store={store} />

      <footer class="xap-panel__footer">
        <span>{t("panel.count", { count: itemCount })}</span>
        <button
          type="button"
          class="xap-panel__clear-btn"
          aria-label={t("panel.clear.label")}
          title={t("panel.clear.label")}
          disabled={itemCount === 0}
          onClick={() => store.clearPlaylist()}
        >
          {t("panel.clear")}
        </button>
      </footer>
    </div>
  );
}
