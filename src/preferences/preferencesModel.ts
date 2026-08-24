export const PREFERENCES_VERSION = 1;
export const PREFERENCES_STORAGE_KEY = "muller.preferences.v1";

export type AppLocale = "system" | "zh-CN" | "en-US";
import { parseThemeColorScheme, type ThemeColorScheme } from "../theme/colorScheme";

export type AppTheme = "system" | "dark" | "light" | "platinum" | "custom";
export type AppDensity = "compact" | "standard";
export type SidebarMode = "option" | "line" | "classic";
export type MotionPreference = "system" | "full" | "reduced";
export type CloseBehavior = "hide" | "quit";

export interface AppPreferencesV1 {
  version: typeof PREFERENCES_VERSION;
  locale: AppLocale;
  theme: AppTheme;
  customTheme: ThemeColorScheme | null;
  glassBackground: boolean;
  density: AppDensity;
  uiScale: number;
  sidebarMode: SidebarMode;
  audioEnabled: boolean;
  audioVolume: number;
  lastNonZeroAudioVolume: number;
  mediaAutoplay: boolean;
  hoverDelayMs: number;
  motion: MotionPreference;
  closeBehavior: CloseBehavior;
  /** Cached UI value only; Windows registration is the source of truth. */
  autostartEnabled: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferencesV1 = {
  version: PREFERENCES_VERSION,
  locale: "system",
  theme: "platinum",
  customTheme: null,
  glassBackground: false,
  density: "compact",
  uiScale: 100,
  sidebarMode: "classic",
  audioEnabled: true,
  audioVolume: 65,
  lastNonZeroAudioVolume: 65,
  mediaAutoplay: false,
  hoverDelayMs: 40,
  motion: "system",
  closeBehavior: "hide",
  autostartEnabled: false,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function member<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

export function parsePreferences(serialized: string | null, legacyWorkspace?: string | null): AppPreferencesV1 {
  let raw: Record<string, unknown> = {};
  try {
    raw = serialized ? JSON.parse(serialized) as Record<string, unknown> : {};
  } catch {
    raw = {};
  }
  let legacy: Record<string, unknown> = {};
  try {
    legacy = legacyWorkspace ? JSON.parse(legacyWorkspace) as Record<string, unknown> : {};
  } catch {
    legacy = {};
  }
  const audioVolume = clamp(Number(raw.audioVolume ?? DEFAULT_PREFERENCES.audioVolume) || 0, 0, 100);
  const legacySidebar = legacy.sidebarMode === "line" ? "line" : legacy.sidebarMode === "option" ? "option" : undefined;
  const customTheme = parseThemeColorScheme(raw.customTheme);
  const requestedTheme = member(
    raw.theme,
    ["system", "dark", "light", "platinum", "custom"],
    DEFAULT_PREFERENCES.theme,
  );
  return {
    version: PREFERENCES_VERSION,
    locale: member(raw.locale, ["system", "zh-CN", "en-US"], "system"),
    theme: requestedTheme === "custom" && customTheme === null
      ? DEFAULT_PREFERENCES.theme
      : requestedTheme,
    customTheme,
    glassBackground: typeof raw.glassBackground === "boolean" ? raw.glassBackground : false,
    density: member(raw.density, ["compact", "standard"], "compact"),
    uiScale: clamp(Number(raw.uiScale ?? legacy.uiScale ?? 100) || 100, 80, 125),
    sidebarMode: member(raw.sidebarMode ?? legacySidebar, ["option", "line", "classic"], "classic"),
    audioEnabled: typeof raw.audioEnabled === "boolean" ? raw.audioEnabled : true,
    audioVolume,
    lastNonZeroAudioVolume: clamp(Number(raw.lastNonZeroAudioVolume) || audioVolume || 65, 1, 100),
    mediaAutoplay: typeof raw.mediaAutoplay === "boolean" ? raw.mediaAutoplay : false,
    hoverDelayMs: clamp(Number(raw.hoverDelayMs ?? 40) || 0, 0, 300),
    motion: member(raw.motion, ["system", "full", "reduced"], "system"),
    closeBehavior: member(raw.closeBehavior, ["hide", "quit"], "hide"),
    autostartEnabled: typeof raw.autostartEnabled === "boolean" ? raw.autostartEnabled : false,
  };
}

export function resolveLocale(locale: AppLocale, systemLocale = navigator.language): "zh-CN" | "en-US" {
  return locale === "system" ? (systemLocale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US") : locale;
}

export function audioVolumeGain(volume: number): number {
  const normalized = clamp(volume, 0, 100) / 100;
  if (normalized === 0) return 0;
  const perceptualGain = normalized ** 2;
  const highEndBoost = 1 + 0.55 * normalized ** 4;
  return perceptualGain * highEndBoost;
}
