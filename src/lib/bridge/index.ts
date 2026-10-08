// Bridge between the ISOLATED content script and the Service Worker (docs/architecture.md §4).
import { effect } from "@preact/signals";
import type { Store } from "@/lib/store";
import type { Ack, ContentToSwMessage, SwToContentMessage } from "@/shared/messages";

export interface BridgeOptions {
  store: Store;
  onTogglePanel: () => void;
  onAddFromContext: (position: "end" | "next") => void;
}

function isSwToContentMessage(value: unknown): value is SwToContentMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "TOGGLE_PANEL" || type === "ADD_FROM_CONTEXT";
}

/** Sends a message to the service worker. Never throws; failures are logged and swallowed. */
export async function sendToBackground(message: ContentToSwMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.warn(`x-auto-playlist: failed to send "${message.type}" to background`, error);
  }
}

export function initBridge(options: BridgeOptions): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isSwToContentMessage(message)) {
      return undefined;
    }
    switch (message.type) {
      case "TOGGLE_PANEL":
        options.onTogglePanel();
        break;
      case "ADD_FROM_CONTEXT":
        options.onAddFromContext(message.position);
        break;
    }
    const ack: Ack = { ok: true };
    sendResponse(ack);
    return undefined;
  });

  effect(() => {
    const count = options.store.itemCount.value;
    void sendToBackground({ type: "SET_BADGE", count });
  });

  effect(() => {
    const open = options.store.panelOpen.value;
    void sendToBackground({ type: "PANEL_STATE", open });
  });
}
