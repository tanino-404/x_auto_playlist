import { signal } from "@preact/signals";
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_MESSAGES } from "@/lib/context-target";
import {
  currentLanguage,
  format,
  initI18n,
  type MessageKey,
  resolveLanguage,
  t,
  translate,
} from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { ja } from "@/lib/i18n/ja";
import { noticeText } from "@/lib/post-actions/logic";
import type { Language } from "@/shared/types";

afterEach(() => initI18n(null));

describe("dictionaries", () => {
  it("ja and en have the same key set", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });

  it("every string is non-empty in both languages", () => {
    for (const dict of [ja, en] as Record<string, string>[]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), key).not.toBe("");
      }
    }
  });

  it("uses the same placeholders in both languages", () => {
    const names = (text: string) =>
      [...text.matchAll(/\{(\w+)[|}]/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(ja) as MessageKey[]) {
      expect([...new Set(names(en[key]))], key).toEqual([...new Set(names(ja[key]))]);
    }
  });
});

describe("resolveLanguage", () => {
  it("explicit settings win over the browser", () => {
    expect(resolveLanguage("ja", "en-US")).toBe("ja");
    expect(resolveLanguage("en", "ja-JP")).toBe("en");
  });

  it("auto: ja* → ja, anything else → en", () => {
    expect(resolveLanguage("auto", "ja")).toBe("ja");
    expect(resolveLanguage("auto", "ja-JP")).toBe("ja");
    expect(resolveLanguage("auto", "JA")).toBe("ja");
    expect(resolveLanguage("auto", "en-US")).toBe("en");
    expect(resolveLanguage("auto", "fr")).toBe("en");
    expect(resolveLanguage("auto", "")).toBe("en");
  });

  it("an unknown stored value is treated as auto", () => {
    expect(resolveLanguage("de" as Language, "ja-JP")).toBe("ja");
    expect(resolveLanguage("de" as Language, "")).toBe("en");
  });
});

describe("format / translate / t", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(format("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    expect(format("no params")).toBe("no params");
  });

  it("English plural: 1 item / 2 items / 0 items", () => {
    expect(translate("en", "panel.count", { count: 1 })).toBe("1 item");
    expect(translate("en", "panel.count", { count: 2 })).toBe("2 items");
    expect(translate("en", "panel.count", { count: 0 })).toBe("0 items");
    expect(translate("en", "toast.context.addedToEnd", { count: 1 })).toBe(
      "Added 1 item to the playlist",
    );
    expect(translate("en", "toast.context.addedNext", { count: 3 })).toBe(
      "Added 3 items to play next",
    );
  });

  it("Japanese has no plural forms", () => {
    expect(translate("ja", "panel.count", { count: 1 })).toBe("1 件");
    expect(translate("ja", "panel.count", { count: 27 })).toBe("27 件");
  });

  it("an unknown key comes back unchanged", () => {
    expect(translate("en", "no.such.key" as MessageKey)).toBe("no.such.key");
    expect(t("no.such.key" as MessageKey)).toBe("no.such.key");
  });

  it("t follows the bound settings and switches immediately", () => {
    const settings = signal<{ language: Language }>({ language: "ja" });
    initI18n({ settings });
    expect(currentLanguage.value).toBe("ja");
    expect(t("panel.empty")).toBe("まだメディアがありません");
    settings.value = { language: "en" };
    expect(currentLanguage.value).toBe("en");
    expect(t("panel.empty")).toBe("No media yet");
    expect(t("panel.count", { count: 27 })).toBe("27 items");
  });

  it("lib texts are produced in the current language", () => {
    const settings = signal<{ language: Language }>({ language: "en" });
    initI18n({ settings });
    expect(noticeText({ ok: true, action: "like", on: true }, true)).toBe("Liked");
    expect(noticeText({ ok: false, action: "repost", reason: "network" }, true)).toBe(
      "Couldn't repost (network error)",
    );
    expect(CONTEXT_MESSAGES.addedToEnd(1)).toBe("Added 1 item to the playlist");
    settings.value = { language: "ja" };
    expect(noticeText({ ok: true, action: "like", on: true }, true)).toBe("いいねしました");
    expect(CONTEXT_MESSAGES.addedToEnd(2)).toBe("プレイリストに 2 件追加しました");
  });
});
