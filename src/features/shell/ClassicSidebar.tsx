import { ChevronDown, ChevronRight, Folder, HardDrive, Monitor } from "lucide-react";
import { useCallback, useState, type MouseEvent } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { completeDirectoryPath } from "./windowsNavigationClient";
import type { QuickLocation } from "./LocationRail";

interface ClassicSidebarProps {
  locations: readonly QuickLocation[];
  selected: number;
  onNavigate: (location: QuickLocation, disposition: "current" | "newTab") => void;
  onTick?: () => void;
}

export function ClassicSidebar({ locations, selected, onNavigate, onTick }: ClassicSidebarProps) {
  const { t } = useAppI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, QuickLocation[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const toggle = useCallback(async (location: QuickLocation) => {
    const key = location.id;
    if (expanded.has(key)) {
      setExpanded((current) => { const next = new Set(current); next.delete(key); return next; });
      return;
    }
    setExpanded((current) => new Set(current).add(key));
    if (location.target.kind !== "directory" || children.has(key)) return;
    setLoading((current) => new Set(current).add(key));
    try {
      const paths = await completeDirectoryPath(`${location.target.path.replace(/[\\/]+$/, "")}\\`);
      setChildren((current) => new Map(current).set(key, paths.map((path) => ({
        id: `tree-${path.toLocaleLowerCase("en-US")}`,
        label: path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? path,
        target: { kind: "directory" as const, path },
      }))));
    } catch {
      setChildren((current) => new Map(current).set(key, []));
    } finally {
      setLoading((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }, [children, expanded]);

  const open = (event: MouseEvent, location: QuickLocation) => {
    if (event.button === 1) event.preventDefault();
    onNavigate(location, event.button === 1 ? "newTab" : "current");
  };

  const renderNode = (location: QuickLocation, depth: number, isSelected = false) => {
    const isDirectory = location.target.kind === "directory";
    const isThisPc = location.target.kind === "this-pc";
    const isDrive = location.target.kind === "directory" && /^[a-z]:[\\/]?$/i.test(location.target.path);
    const isExpanded = expanded.has(location.id);
    const Icon = isThisPc ? Monitor : isDrive ? HardDrive : Folder;
    return (
      <div className={`classic-tree-node${isThisPc ? " is-this-pc" : ""}${isDrive ? " is-drive" : ""}`} key={location.id}>
        <div className={isSelected ? "classic-tree-row is-selected" : "classic-tree-row"} style={{ paddingLeft: 6 + depth * 14 }} onPointerEnter={onTick}>
          {isDirectory ? <button className="classic-tree-toggle" type="button" aria-label={isExpanded ? t("collapse") : t("expand")} aria-expanded={isExpanded} onClick={() => void toggle(location)}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="classic-tree-spacer" />}
          <button
            className="classic-tree-label"
            type="button"
            data-drop-directory={location.target.kind === "directory" ? location.target.path : undefined}
            onClick={(event) => open(event, location)}
            onAuxClick={(event) => open(event, location)}
            onDoubleClick={isDirectory ? () => void toggle(location) : undefined}
          >
            <Icon size={15} /><span>{location.label}</span>
          </button>
        </div>
        {isExpanded ? <div role="group">{loading.has(location.id) ? <div className="classic-tree-loading" style={{ paddingLeft: 34 + depth * 14 }}>...</div> : (children.get(location.id) ?? []).map((child) => renderNode(child, depth + 1))}</div> : null}
      </div>
    );
  };

  return <nav className="classic-sidebar" aria-label={t("explorerLocations")}>{locations.map((location, index) => renderNode(location, 0, index === selected))}</nav>;
}
