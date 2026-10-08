// Mounts the Preact app into the Shadow DOM container WXT gives us. Wired from
// src/entrypoints/x.content.ts via createShadowRootUi's onMount/onRemove.
import { effect } from "@preact/signals";
import { render } from "preact";
import { createPageLayout } from "@/lib/layout";
import type { Player } from "@/lib/player";
import type { PostActions } from "@/lib/post-actions";
import type { Store } from "@/lib/store";
import { App } from "@/ui/App";

export interface MountArgs {
  container: HTMLElement;
  shadow: ShadowRoot;
  host: HTMLElement;
  store: Store;
  player: Player;
  postActions: PostActions;
}

export interface Mounted {
  unmount(): void;
}

export function mountUi(args: MountArgs): Mounted {
  render(
    <App store={args.store} player={args.player} postActions={args.postActions} />,
    args.container,
  );

  // Split view (F-10 / F-19, docs/architecture.md §7.1): push x.com's own document left by the
  // panel's width instead of overlaying it. Kept outside the component tree so it stays paired
  // with dispose() below regardless of what renders.
  const layout = createPageLayout();
  const stopLayoutEffect = effect(() => {
    const { store } = args;
    const width = store.panelOpen.value ? store.uiPrefs.value.panelWidth : null;
    layout.apply(width);
  });

  return {
    unmount() {
      render(null, args.container);
      stopLayoutEffect();
      layout.dispose();
    },
  };
}
