// Shared file: edited by the PL only.
// ISOLATED-world content script for x.com. This is the single place where modules are wired.

import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { initBridge } from "@/lib/bridge";
import { createCollectorPipeline } from "@/lib/collector/pipeline";
import { createContextTarget } from "@/lib/context-target";
import { installDebugHooks } from "@/lib/debug";
import { installHotkeys } from "@/lib/hotkeys";
import { listenInterceptedResponses, listenObservedMutations } from "@/lib/interceptor/listen";
import { createNavigation } from "@/lib/navigation";
import { createPlayer } from "@/lib/player";
import { createPostActions } from "@/lib/post-actions";
import { createPostCache } from "@/lib/post-cache";
import { createScroller } from "@/lib/scroller";
import { createSiteVideoPauser } from "@/lib/site-videos";
import { initStore } from "@/lib/store";
import { UI_HOST_NAME } from "@/shared/constants";
import { mountUi } from "@/ui/mount";
import "@/ui/theme/tokens.css";

export default defineContentScript({
  matches: ["https://x.com/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  async main(ctx) {
    const store = await initStore();
    const player = createPlayer({ store });
    const postCache = createPostCache();
    const navigation = createNavigation({ store });

    // Collection: raw GraphQL responses (forwarded by the MAIN-world interceptor)
    // → collector → post cache / auto playlist.
    listenInterceptedResponses(createCollectorPipeline({ store, postCache, navigation }));

    // Auto-scroll while playing (auto mode only), honouring X's rate limits.
    const scroller = createScroller({ store, navigation });

    // Right-click "add to playlist": remembers the element under the pointer and resolves
    // the post from the post cache when the service worker relays the menu click.
    const contextTarget = createContextTarget({ store, postCache });

    // Like / bookmark / repost from the player (F-4C). The only writes this extension sends.
    const postActions = createPostActions({ store });
    listenObservedMutations((m) => postActions.learnQueryId(m.operation, m.queryId));

    // Pause x.com's own (muted, autoplaying) videos while our player is playing (S-15).
    createSiteVideoPauser({ store });

    const ui = await createShadowRootUi(ctx, {
      name: UI_HOST_NAME,
      position: "inline",
      anchor: "body",
      append: "last",
      // Keyboard events are handled by our own hotkeys module; do not let WXT swallow them.
      isolateEvents: false,
      onMount: (container, shadow, host) => {
        // The host covers the viewport but lets clicks through except where our UI is.
        host.style.cssText =
          "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;";
        container.style.cssText = "position:relative;width:100%;height:100%;pointer-events:none;";
        return mountUi({ container, shadow, host, store, player, postActions });
      },
      onRemove: (mounted) => {
        mounted?.unmount();
      },
    });
    ui.mount();

    // Keyboard shortcuts (S-17). Active only while the panel is open and a player exists.
    installHotkeys({ store, player });

    initBridge({
      store,
      onTogglePanel: () => store.togglePanel(),
      onAddFromContext: (position) => contextTarget.addFromLastTarget(position),
    });

    if (import.meta.env.DEV) {
      // Development-only hooks used by the PL's audit scripts. Stripped from production builds.
      installDebugHooks({
        store,
        player,
        postCache,
        navigation,
        scroller,
        contextTarget,
        postActions,
      });
    }
  },
});
