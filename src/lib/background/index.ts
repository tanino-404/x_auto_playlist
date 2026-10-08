// Service Worker entry point (docs/architecture.md §3/§4).

import type { Ack, ContentToSwMessage, SwToContentMessage } from "@/shared/messages";
import { CONTEXT_MENU_IDS } from "@/shared/messages";

/** Same value as --xap-accent in src/ui/theme/tokens.css. */
const BADGE_ACCENT_COLOR = "#1d9bf0";

function isContentToSwMessage(value: unknown): value is ContentToSwMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "SET_BADGE" || type === "PANEL_STATE";
}

async function setupSessionAccess(): Promise<void> {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  } catch (error) {
    console.debug("x-auto-playlist: storage.session.setAccessLevel failed", error);
  }
}

async function setupContextMenus(): Promise<void> {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.addToEnd,
      title: "プレイリストに追加",
      contexts: ["all"],
      documentUrlPatterns: ["https://x.com/*"],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.addNext,
      title: "次に再生",
      contexts: ["all"],
      documentUrlPatterns: ["https://x.com/*"],
    });
  } catch (error) {
    console.debug("x-auto-playlist: contextMenus setup failed", error);
  }
}

function sendToTab(tabId: number, message: SwToContentMessage): void {
  chrome.tabs.sendMessage(tabId, message).catch((error: unknown) => {
    // Expected on any tab without our content script (i.e. not x.com).
    console.debug(`x-auto-playlist: could not deliver "${message.type}" to tab`, tabId, error);
  });
}

export function setupBackground(): void {
  chrome.runtime.onInstalled.addListener(() => {
    void setupSessionAccess();
    void setupContextMenus();
  });

  chrome.runtime.onStartup.addListener(() => {
    void setupSessionAccess();
    void setupContextMenus();
  });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) {
      return;
    }
    sendToTab(tab.id, { type: "TOGGLE_PANEL" });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id === undefined) {
      return;
    }
    if (info.menuItemId === CONTEXT_MENU_IDS.addToEnd) {
      sendToTab(tab.id, { type: "ADD_FROM_CONTEXT", position: "end" });
    } else if (info.menuItemId === CONTEXT_MENU_IDS.addNext) {
      sendToTab(tab.id, { type: "ADD_FROM_CONTEXT", position: "next" });
    }
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isContentToSwMessage(message)) {
      return undefined;
    }
    if (message.type === "SET_BADGE") {
      const tabId = sender.tab?.id;
      chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : "", tabId });
      chrome.action.setBadgeBackgroundColor({ color: BADGE_ACCENT_COLOR, tabId });
    }
    // PANEL_STATE is not consumed by the background yet (nothing needs it in stage 0).
    const ack: Ack = { ok: true };
    sendResponse(ack);
    return undefined;
  });
}
