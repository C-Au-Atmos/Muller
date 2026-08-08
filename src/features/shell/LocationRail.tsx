import { useMemo } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { LineSidebar } from "../../ui/react-bits/LineSidebar/LineSidebar";
import { OptionWheel } from "../../ui/react-bits/OptionWheel/OptionWheel";
import { SpecularButton } from "../../ui/react-bits/SpecularButton/SpecularButton";
import type { SidebarMode } from "../../preferences/preferencesModel";
import type { VirtualLocation, WorkspaceMode } from "../../workspace/workspaceModel";
import { ClassicSidebar } from "./ClassicSidebar";

export type QuickLocationTarget =
  | { kind: "this-pc" }
  | { kind: "directory"; path: string; mode?: WorkspaceMode };

export interface QuickLocation {
  id: string;
  label: string;
  target: QuickLocationTarget;
}

interface LocationRailProps {
  mode: SidebarMode;
  path: string;
  virtualLocation: VirtualLocation;
  locations: readonly QuickLocation[];
  soundEnabled: boolean;
  onModeChange: (mode: SidebarMode) => void;
  onNavigate: (location: QuickLocation, disposition?: "current" | "newTab") => void;
  onTick: () => void;
}

export function LocationRail({ mode, path, virtualLocation, locations, soundEnabled, onModeChange, onNavigate, onTick }: LocationRailProps) {
  const { t } = useAppI18n();
  const labels = useMemo(() => locations.map((location) => location.label), [locations]);
  const selected = locations.findIndex((location) => {
    if (location.target.kind === "this-pc") return virtualLocation === "this-pc";
    return virtualLocation === null && location.target.path.toLowerCase() === path.toLowerCase();
  });
  const change = (index: number, disposition: "current" | "newTab" = "current") => {
    const location = locations[index];
    if (location) onNavigate(location, disposition);
  };
  return (
    <aside className="location-rail" aria-label={t("locations")}>
      <span className="location-rail__label">{t("locations")}</span>
      <div className="location-rail__body">
        {mode === "option" ? (
          <OptionWheel
            items={labels}
            selected={selected}
            onChange={(index) => change(index)}
            onTick={soundEnabled ? onTick : undefined}
          />
        ) : mode === "line" ? (
          <LineSidebar items={labels} selected={selected} onChange={(index) => change(index)} onTick={soundEnabled ? onTick : undefined} />
        ) : (
          <ClassicSidebar locations={locations} selected={selected} onNavigate={onNavigate} onTick={soundEnabled ? onTick : undefined} />
        )}
      </div>
      <div className="location-rail__switch" aria-label={t("sidebarStyle")}>
        <SpecularButton compact className={mode === "option" ? "is-active" : ""} aria-label={t("optionWheelSidebar")} title={t("optionWheelSidebar")} onClick={() => onModeChange("option")}>OW</SpecularButton>
        <SpecularButton compact className={mode === "line" ? "is-active" : ""} aria-label={t("lineSidebar")} title={t("lineSidebar")} onClick={() => onModeChange("line")}>LS</SpecularButton>
        <SpecularButton compact className={mode === "classic" ? "is-active" : ""} aria-label={t("classicSidebar")} title={t("classicSidebar")} onClick={() => onModeChange("classic")}>CL</SpecularButton>
      </div>
    </aside>
  );
}
