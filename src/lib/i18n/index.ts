// UI language (F-60, settings S-21). `currentLanguage` follows store.settings.language once
// initI18n() binds it; before that (and in tests) it follows the browser ("auto").
// Inside Preact components t() reads the signal, so switching the language re-renders at once.
// Outside components the text is fixed in the language active when t() was called.
import type { ReadonlySignal } from "@preact/signals";
import { computed, signal } from "@preact/signals";
import {
  browserLanguage,
  type MessageKey,
  type MessageParams,
  type ResolvedLanguage,
  resolveLanguage,
  translate,
} from "@/lib/i18n/core";
import type { Language } from "@/shared/types";

export * from "@/lib/i18n/core";

/** What initI18n needs from the store (a structural subset, so tests can pass a fake). */
export interface I18nSource {
  settings: ReadonlySignal<{ language: Language }>;
}

const source = signal<I18nSource | null>(null);

export const currentLanguage: ReadonlySignal<ResolvedLanguage> = computed(() =>
  resolveLanguage(source.value?.settings.value.language ?? "auto", browserLanguage()),
);

/** Binds currentLanguage to the store's settings (null unbinds). Calling it again rebinds. */
export function initI18n(store: I18nSource | null): void {
  source.value = store;
}

/** The string for `key` in the current language. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(currentLanguage.value, key, params);
}
