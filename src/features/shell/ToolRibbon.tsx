import {
  Columns2,
  CopyCheck,
  FolderOpen,
  GalleryVerticalEnd,
  Grid3X3,
  Images,
  LayoutList,
  PanelTopOpen,
  SlidersHorizontal,
} from "lucide-react";

import { useAppI18n, type TranslationKey } from "../../i18n/i18n";
import { SpecularButton } from "../../ui/react-bits/SpecularButton/SpecularButton";
import type { DirectoryPresentation, WorkspaceMode } from "../../workspace/workspaceModel";

interface ToolRibbonProps {
  mode: WorkspaceMode;
  presentation: DirectoryPresentation;
  filterOpen: boolean;
  filterCount: number;
  operationsCollapsed: boolean;
  onModeChange: (mode: WorkspaceMode) => void;
  onPresentationChange: (presentation: DirectoryPresentation) => void;
  onFilterToggle: () => void;
  onOperationsExpand: () => void;
}

const MODES = [
  { id: "browse", label: "browse", icon: FolderOpen },
  { id: "duplicates", label: "duplicates", icon: CopyCheck },
  { id: "compare", label: "compare", icon: Columns2 },
  { id: "album", label: "album", icon: Images },
] as const;

const VIEWS = [
  { id: "list", label: "list", icon: LayoutList },
  { id: "cubes-grid", label: "largeIcons", icon: Grid3X3 },
] as const;

export function ToolRibbon({
  mode,
  presentation,
  filterOpen,
  filterCount,
  operationsCollapsed,
  onModeChange,
  onPresentationChange,
  onFilterToggle,
  onOperationsExpand,
}: ToolRibbonProps) {
  const { t } = useAppI18n();
  const explorerMode = mode === "browse" || mode === "album";
  return (
    <div className="tool-ribbon" aria-label={t("workspaceTools")}>
      <div className="tool-ribbon__modes">
        {MODES.map(({ id, label, icon: Icon }) => (
          <SpecularButton
            key={id}
            className={mode === id ? "tool-button is-active" : "tool-button"}
            aria-label={t(label as TranslationKey)}
            aria-pressed={mode === id}
            onClick={() => onModeChange(id)}
          >
            <Icon size={14} /><span>{t(label as TranslationKey)}</span>
          </SpecularButton>
        ))}
      </div>
      <span className="tool-ribbon__separator" />
      <div className="tool-ribbon__views" aria-label={t("directoryPresentation")}>
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <SpecularButton
            compact
            key={id}
            className={presentation === id && explorerMode ? "view-button is-active" : "view-button"}
            aria-label={t(label as TranslationKey)}
            title={t(label as TranslationKey)}
            disabled={!explorerMode}
            aria-pressed={presentation === id && explorerMode}
            onClick={() => onPresentationChange(id)}
          >
            <Icon size={15} />
          </SpecularButton>
        ))}
        <SpecularButton
          compact
          className={mode === "album" ? "view-button is-active" : "view-button"}
          aria-label={t("masonryAlbum")}
          title={t("masonryAlbum")}
          aria-pressed={mode === "album"}
          onClick={() => onModeChange("album")}
        >
          <GalleryVerticalEnd size={15} />
        </SpecularButton>
      </div>
      <div className="tool-ribbon__spacer" />
      {operationsCollapsed && explorerMode ? (
        <SpecularButton
          compact
          className="view-button tool-ribbon__restore-actions"
          aria-label={t("expandFileActions")}
          title={t("expandFileActions")}
          onClick={onOperationsExpand}
        >
          <PanelTopOpen size={15} />
        </SpecularButton>
      ) : null}
      <SpecularButton
        className={filterOpen ? "filter-trigger is-active" : "filter-trigger"}
        aria-label={t("filters")}
        aria-expanded={filterOpen}
        aria-controls="workspace-filter-menu"
        disabled={!explorerMode}
        onClick={onFilterToggle}
      >
        <SlidersHorizontal size={14} /><span>{t("filters")}</span>
        {filterCount > 0 ? <b>{filterCount}</b> : null}
      </SpecularButton>
    </div>
  );
}
