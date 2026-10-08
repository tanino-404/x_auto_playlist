// Theme resolution (ISOLATED world). "system" is resolved against matchMedia.
import { useEffect, useState } from "preact/hooks";
import type { Store } from "@/lib/store";
import type { Theme } from "@/shared/types";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Pure: resolves the user-facing Theme setting to the two themes tokens.css defines. */
export function resolveTheme(setting: Theme, prefersDark: boolean): "light" | "dark" {
  if (setting === "system") {
    return prefersDark ? "dark" : "light";
  }
  return setting;
}

function readPrefersDark(): boolean {
  return typeof matchMedia === "function" ? matchMedia(DARK_MEDIA_QUERY).matches : false;
}

/**
 * Preact hook returning the resolved theme. Reads store.settings.value.theme (which
 * re-renders the caller automatically via @preact/signals' Preact integration) and,
 * for "system", subscribes to matchMedia changes for as long as the component is mounted.
 */
export function useResolvedTheme(store: Store): "light" | "dark" {
  const theme = store.settings.value.theme;
  const [prefersDark, setPrefersDark] = useState(readPrefersDark);

  useEffect(() => {
    if (typeof matchMedia !== "function") {
      return undefined;
    }
    const mql = matchMedia(DARK_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return resolveTheme(theme, prefersDark);
}
