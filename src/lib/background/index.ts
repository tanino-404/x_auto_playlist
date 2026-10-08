// Service Worker entry point (docs/architecture.md §3/§4).

import {
  browserLanguage,
  type ResolvedLanguage,
  resolveLanguage,
  translate,
} from "@/lib/i18n/core";
import type { Ack, ContentToSwMessage, SwToContentMessage } from "@/shared/messages";
import { CONTEXT_MENU_IDS } from "@/shared/messages";
import type { Language } from "@/shared/types";

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

/** Same key as the store's chrome.storage.local "settings". */
const SETTINGS_KEY = "settings";

function languageOf(settings: unknown): ResolvedLanguage {
  const value =
    typeof settings === "object" && settings !== null
      ? (settings as { language?: unknown }).language
      : undefined;
  const setting: Language = value === "ja" || value === "en" ? value : "auto";
  return resolveLanguage(setting, browserLanguage());
}

/** F-60: the menu titles follow settings.language (S-21). */
async function readMenuLanguage(): Promise<ResolvedLanguage> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return languageOf(stored[SETTINGS_KEY]);
  } catch (error) {
    console.debug("x-auto-playlist: could not read settings for the menu language", error);
    return languageOf(undefined);
  }
}

function menuTitles(language: ResolvedLanguage): { addToEnd: string; addNext: string } {
  return {
    addToEnd: translate(language, "contextMenu.addToEnd"),
    addNext: translate(language, "contextMenu.addNext"),
  };
}

let menuLanguage: ResolvedLanguage | null = null;

async function setupContextMenus(): Promise<void> {
  try {
    const language = await readMenuLanguage();
    const titles = menuTitles(language);
    menuLanguage = language;
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.addToEnd,
      title: titles.addToEnd,
      contexts: ["all"],
      documentUrlPatterns: ["https://x.com/*"],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.addNext,
      title: titles.addNext,
      contexts: ["all"],
      documentUrlPatterns: ["https://x.com/*"],
    });
  } catch (error) {
    console.debug("x-auto-playlist: contextMenus setup failed", error);
  }
}

/** Retitles the existing menu items when settings.language changes. */
function onSettingsChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): void {
  const change = changes[SETTINGS_KEY];
  if (areaName !== "local" || change === undefined) {
    return;
  }
  const language = languageOf(change.newValue);
  if (language === menuLanguage) {
    return;
  }
  menuLanguage = language;
  const titles = menuTitles(language);
  const update = (id: string, title: string) =>
    chrome.contextMenus.update(id, { title }).catch((error: unknown) => {
      console.debug("x-auto-playlist: contextMenus.update failed", id, error);
    });
  void update(CONTEXT_MENU_IDS.addToEnd, titles.addToEnd);
  void update(CONTEXT_MENU_IDS.addNext, titles.addNext);
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

  chrome.storage.onChanged.addListener(onSettingsChanged);

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
