// Root Preact component mounted into the Shadow DOM. See docs/architecture.md §7.1 / §7.2.
import { useMemo, useRef, useState } from "preact/hooks";
import type { Player } from "@/lib/player";
import type { PostActions } from "@/lib/post-actions";
import { PostActionsContext } from "@/lib/post-actions/context";
import type { Store } from "@/lib/store";
import { useResolvedTheme } from "@/lib/theme";
import { readDurationMs, usePresence } from "@/ui/components/motion";
import { OverlayContext } from "@/ui/components/overlay";
import "@/ui/components/components.css";
import { SidePanel } from "@/ui/panel/SidePanel";
import { PlayerWindow } from "@/ui/player-window/PlayerWindow";

export interface AppProps {
  store: Store;
  player: Player;
  /** F-4C. Absent (e.g. in isolated tests) hides the like / bookmark / repost buttons. */
  postActions?: PostActions;
}

export function App({ store, player, postActions }: AppProps) {
  const resolvedTheme = useResolvedTheme(store);
  // Fullscreen is requested on this element so the panel and the player go fullscreen together.
  const rootRef = useRef<HTMLDivElement>(null);
  const hasCurrent = store.playback.value.currentId !== null;
  // Top layer for toasts / row menus (above the floating player). See components/overlay.ts.
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  // Both stay rendered for their exit animation (player fades out, panel slides out).
  const playerPresence = usePresence(hasCurrent, () =>
    readDurationMs(rootRef.current, "--xap-dur"),
  );
  const panelPresence = usePresence(store.panelOpen.value, () =>
    readDurationMs(rootRef.current, "--xap-dur-slow"),
  );
  const postActionsValue = useMemo(
    () => (postActions === undefined ? null : { postActions, store }),
    [postActions, store],
  );

  return (
    <div
      ref={rootRef}
      class="xap-root"
      data-theme={resolvedTheme}
      style={{ height: "100%", pointerEvents: "none" }}
    >
      <OverlayContext.Provider value={overlay}>
        <PostActionsContext.Provider value={postActionsValue}>
          {/* Stacking is set by z-index: panel < floating player < overlay. */}
          {playerPresence.mounted && (
            <PlayerWindow
              store={store}
              player={player}
              rootRef={rootRef}
              leaving={playerPresence.leaving}
            />
          )}
          {panelPresence.mounted && (
            <SidePanel store={store} player={player} leaving={panelPresence.leaving} />
          )}
        </PostActionsContext.Provider>
      </OverlayContext.Provider>
      <div class="xap-overlay" ref={setOverlay} />
    </div>
  );
}
