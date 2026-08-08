import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  parsePreferences,
  resolveLocale,
  type AppPreferencesV1,
} from "./preferencesModel";
import {
  MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME,
  applyThemeColorScheme,
} from "../theme/colorScheme";

export function usePreferences() {
  const [preferences, setPreferences] = useState<AppPreferencesV1>(() => {
    const stored = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    const legacyWorkspace = window.localStorage.getItem("muller.workspace.v2");
    const migrated = parsePreferences(stored, legacyWorkspace);
    if (!stored && window.localStorage.getItem("muller.audio.enabled") === "false") {
      migrated.audioEnabled = false;
    }
    return migrated;
  });

  const updatePreferences = useCallback((patch: Partial<Omit<AppPreferencesV1, "version">>) => {
    setPreferences((current) => parsePreferences(JSON.stringify({ ...current, ...patch })));
  }, []);

  const resetPreferences = useCallback(() => setPreferences(DEFAULT_PREFERENCES), []);

  useEffect(() => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const scheme = preferences.theme === "custom"
        ? preferences.customTheme
        : preferences.theme === "platinum"
          ? MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME
          : null;
      const theme = preferences.theme === "custom"
        ? scheme?.mode ?? "dark"
        : preferences.theme === "platinum"
          ? MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME.mode
          : preferences.theme === "system"
          ? (media.matches ? "light" : "dark")
          : preferences.theme;
      root.dataset.theme = theme;
      root.dataset.themeSource = preferences.theme === "custom" ? "custom" : "built-in";
      root.dataset.glass = String(preferences.glassBackground);
      applyThemeColorScheme(root, scheme);
      root.dataset.density = preferences.density;
      root.dataset.motion = preferences.motion;
      root.lang = resolveLocale(preferences.locale);
      root.style.setProperty("--ui-scale", String(preferences.uiScale / 100));
      document.body.style.removeProperty("background");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences]);

  return { preferences, updatePreferences, resetPreferences };
}
