// Pure i18n helpers (F-60), usable from the service worker (no signals, no DOM).
import { en } from "@/lib/i18n/en";
import { ja, type MessageKey } from "@/lib/i18n/ja";
import type { Language } from "@/shared/types";

export type { MessageKey } from "@/lib/i18n/ja";
export type ResolvedLanguage = "ja" | "en";
export type MessageParams = Record<string, string | number>;

export const DICTIONARIES: Record<ResolvedLanguage, Record<MessageKey, string>> = { ja, en };

/** "auto" follows the browser: "ja*" → Japanese, anything else (or unknown) → English. */
export function resolveLanguage(setting: Language, navigatorLanguage: string): ResolvedLanguage {
  if (setting === "ja" || setting === "en") {
    return setting;
  }
  return navigatorLanguage.toLowerCase().startsWith("ja") ? "ja" : "en";
}

/** navigator.language, or "" where there is no navigator (some test environments). */
export function browserLanguage(): string {
  return typeof navigator !== "undefined" && typeof navigator.language === "string"
    ? navigator.language
    : "";
}

/**
 * Fills placeholders: "{name}" → params.name; "{name|one|other}" → `one` when params.name is 1,
 * else `other` (the minimal English plural). Placeholders without a param are left as is.
 */
export function format(template: string, params?: MessageParams): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(
    /\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g,
    (match, name: string, one: string | undefined, other: string | undefined) => {
      const value = params[name];
      if (value === undefined) {
        return match;
      }
      if (one !== undefined) {
        return Number(value) === 1 ? one : (other ?? "");
      }
      return String(value);
    },
  );
}

/** The string for `key` in `language`; an unknown key comes back unchanged. */
export function translate(
  language: ResolvedLanguage,
  key: MessageKey,
  params?: MessageParams,
): string {
  const template = (DICTIONARIES[language] as Partial<Record<string, string>>)[key];
  return template === undefined ? key : format(template, params);
}
