import { Download, Languages, MonitorCog, MousePointer2, Palette, RotateCcw, Upload, Volume2 } from "lucide-react";
import { useRef, useState, type ChangeEvent, type CSSProperties } from "react";

import type { AppPreferencesV1 } from "../../preferences/preferencesModel";
import { useI18n } from "../../i18n/i18n";
import {
  DEFAULT_DARK_COLOR_SCHEME,
  DEFAULT_LIGHT_COLOR_SCHEME,
  MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME,
  parseThemeColorScheme,
  serializeThemeColorScheme,
} from "../../theme/colorScheme";

interface SettingsPageProps {
  preferences: AppPreferencesV1;
  onChange: (patch: Partial<Omit<AppPreferencesV1, "version">>) => void;
  onReset: () => void;
}

function rangeStyle(value: number, minimum: number, maximum: number): CSSProperties {
  const progress = ((value - minimum) / (maximum - minimum)) * 100;
  return { "--range-progress": `${Math.min(Math.max(progress, 0), 100)}%` } as CSSProperties;
}

function Segmented<T extends string>({ value, options, label, onChange }: {
  value: T;
  options: readonly { value: T; label: string }[];
  label: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "is-active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage({ preferences, onChange, onReset }: SettingsPageProps) {
  const { t } = useI18n(preferences.locale);
  const themeFileRef = useRef<HTMLInputElement>(null);
  const [themeFileStatus, setThemeFileStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const delayPreset = [0, 40, 150].includes(preferences.hoverDelayMs)
    ? String(preferences.hoverDelayMs)
    : "custom";

  const importTheme = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseThemeColorScheme(JSON.parse(await file.text()) as unknown);
      if (!parsed) throw new Error("invalid theme");
      onChange({ theme: "custom", customTheme: parsed });
      setThemeFileStatus({ kind: "success", message: t("themeImportSuccess", { name: parsed.name }) });
    } catch {
      setThemeFileStatus({ kind: "error", message: t("themeImportError") });
    }
  };

  const exportTheme = () => {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    const scheme = preferences.theme === "custom" && preferences.customTheme
      ? preferences.customTheme
      : preferences.theme === "platinum"
        ? MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME
      : preferences.theme === "light" || (preferences.theme === "system" && prefersLight)
        ? DEFAULT_LIGHT_COLOR_SCHEME
        : DEFAULT_DARK_COLOR_SCHEME;
    const filename = scheme.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "muller-theme";
    const url = URL.createObjectURL(new Blob([serializeThemeColorScheme(scheme)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filename}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setThemeFileStatus({ kind: "success", message: t("themeExportSuccess", { name: scheme.name }) });
  };

  return (
    <main className="settings-page" aria-labelledby="settings-title">
      <header className="settings-heading">
        <div><MonitorCog size={20} /><h1 id="settings-title">{t("settings")}</h1></div>
        <button className="command-button" type="button" onClick={onReset}>
          <RotateCcw size={15} /><span>{t("reset")}</span>
        </button>
      </header>

      <section className="settings-section" aria-labelledby="appearance-title">
        <h2 id="appearance-title"><MonitorCog size={16} />{t("appearance")}</h2>
        <div className="settings-row"><div><strong>{t("theme")}</strong></div><Segmented value={preferences.theme} label={t("theme")} options={[
          { value: "system", label: t("themeSystem") }, { value: "dark", label: t("themeDark") }, { value: "light", label: t("themeLight") }, { value: "platinum", label: t("themePlatinum") }, { value: "custom", label: t("custom") },
        ]} onChange={(theme) => {
          if (theme === "custom" && !preferences.customTheme) themeFileRef.current?.click();
          else onChange({ theme });
        }} /></div>
        <div className="settings-row settings-row--theme-file">
          <div><strong><Palette size={14} />{t("colorConfig")}</strong><small>{preferences.theme === "custom" ? preferences.customTheme?.name : preferences.theme === "platinum" ? MULLER_MONOCHROME_PLATINUM_COLOR_SCHEME.name : t("builtInPalette")}</small></div>
          <div className="theme-config-actions">
            <input ref={themeFileRef} className="theme-file-input" type="file" accept=".json,application/json" onChange={(event) => void importTheme(event)} />
            <button className="command-button" type="button" onClick={() => themeFileRef.current?.click()}><Upload size={15} /><span>{t("importTheme")}</span></button>
            <button className="command-button" type="button" onClick={exportTheme}><Download size={15} /><span>{t("exportTheme")}</span></button>
            {preferences.customTheme ? <button className="icon-button" type="button" aria-label={t("removeCustomTheme")} title={t("removeCustomTheme")} onClick={() => {
              onChange({ theme: "system", customTheme: null });
              setThemeFileStatus(null);
            }}><RotateCcw size={15} /></button> : null}
          </div>
          {themeFileStatus ? <output className={`theme-file-status is-${themeFileStatus.kind}`} role={themeFileStatus.kind === "error" ? "alert" : "status"}>{themeFileStatus.message}</output> : null}
        </div>
        <div className="settings-row"><div><strong>{t("density")}</strong></div><Segmented value={preferences.density} label={t("density")} options={[
          { value: "compact", label: t("densityCompact") }, { value: "standard", label: t("densityStandard") },
        ]} onChange={(density) => onChange({ density })} /></div>
        <label className="settings-row"><div><strong>{t("frostedGlass")}</strong></div><input type="checkbox" checked={preferences.glassBackground} onChange={(event) => onChange({ glassBackground: event.target.checked })} /></label>
        <label className="settings-row"><div><strong>{t("uiScale")}</strong><small>{preferences.uiScale}%</small></div><input type="range" min="80" max="125" step="5" value={preferences.uiScale} style={rangeStyle(preferences.uiScale, 80, 125)} onChange={(event) => onChange({ uiScale: Number(event.target.value) })} /></label>
      </section>

      <section className="settings-section" aria-labelledby="language-title">
        <h2 id="language-title"><Languages size={16} />{t("language")}</h2>
        <div className="settings-row"><div><strong>{t("language")}</strong></div><Segmented value={preferences.locale} label={t("language")} options={[
          { value: "system", label: t("systemLanguage") }, { value: "zh-CN", label: t("chinese") }, { value: "en-US", label: t("english") },
        ]} onChange={(locale) => onChange({ locale })} /></div>
      </section>

      <section className="settings-section" aria-labelledby="interaction-title">
        <h2 id="interaction-title"><MousePointer2 size={16} />{t("interaction")}</h2>
        <div className="settings-row"><div><strong>{t("sidebar")}</strong></div><Segmented value={preferences.sidebarMode} label={t("sidebar")} options={[
          { value: "option", label: "OW" }, { value: "line", label: "LS" }, { value: "classic", label: "Classic" },
        ]} onChange={(sidebarMode) => onChange({ sidebarMode })} /></div>
        <div className="settings-row"><div><strong>{t("motion")}</strong></div><Segmented value={preferences.motion} label={t("motion")} options={[
          { value: "system", label: t("themeSystem") }, { value: "full", label: t("motionFull") }, { value: "reduced", label: t("motionReduced") },
        ]} onChange={(motion) => onChange({ motion })} /></div>
        <div className="settings-row settings-row--delay"><div><strong>{t("hoverDelay")}</strong><small>{preferences.hoverDelayMs}</small></div><Segmented value={delayPreset} label={t("hoverDelay")} options={[
          { value: "0", label: t("immediate") }, { value: "40", label: t("subtle") }, { value: "150", label: t("gentle") }, { value: "custom", label: t("custom") },
        ]} onChange={(preset) => preset !== "custom" && onChange({ hoverDelayMs: Number(preset) })} /><input aria-label={t("hoverDelay")} type="range" min="0" max="300" value={preferences.hoverDelayMs} style={rangeStyle(preferences.hoverDelayMs, 0, 300)} onChange={(event) => onChange({ hoverDelayMs: Number(event.target.value) })} /></div>
      </section>

      <section className="settings-section" aria-labelledby="sound-title">
        <h2 id="sound-title"><Volume2 size={16} />{t("sound")}</h2>
        <label className="settings-row"><div><strong>{t("interfaceSounds")}</strong></div><input type="checkbox" checked={preferences.audioEnabled} onChange={(event) => onChange({ audioEnabled: event.target.checked })} /></label>
        <label className="settings-row"><div><strong>{t("volume")}</strong><small>{preferences.audioVolume}%</small></div><input type="range" min="0" max="100" value={preferences.audioVolume} style={rangeStyle(preferences.audioVolume, 0, 100)} onChange={(event) => {
          const audioVolume = Number(event.target.value);
          onChange({ audioVolume, audioEnabled: audioVolume > 0, ...(audioVolume > 0 ? { lastNonZeroAudioVolume: audioVolume } : {}) });
        }} /></label>
      </section>
    </main>
  );
}
