import {
  AppWindow,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  Clipboard,
  ClipboardPaste,
  ClipboardCopy,
  Copy,
  Columns3,
  ExternalLink,
  FileArchive,
  FilePlus2,
  Eye,
  FilePenLine,
  FolderInput,
  FolderPlus,
  Info,
  PanelTopClose,
  RefreshCw,
  Scissors,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

import { useAppI18n, type TranslationKey } from "../../i18n/i18n";
import type { DirectoryPresentation } from "../../workspace/workspaceModel";
import { PreviewPanel } from "../preview/PreviewPanel";
import {
  applyMarqueeSelection,
  createSelectionState,
  moveSelectionFocus,
  selectAllPositions,
  selectPosition,
  type SelectionModifiers,
  type SelectionState,
} from "../selection/selectionModel";
import {
  openNativePath,
  cancelFileOperation,
  recycleEntry,
  renameEntry,
  transferDirectoryEntries,
  transferEntry,
  createEntry,
  createZip,
  extractZip,
  openTerminal,
} from "./fileOperationsClient";
import { DialogShell, EntryPropertiesDialog, MenuButton } from "./ExplorerOverlays";
import {
  INTERNAL_FILE_DRAG_MIME,
  parseInternalFileDrag,
  pathIdentity,
  pathsMatch,
  transferModeForDrop,
  type InternalFileDrag,
} from "./fileDrag";
import type {
  ConflictStrategy,
  DirectoryEntry,
  FileClipboardState,
  DirectoryQueryFilter,
  DirectorySearchMode,
  DirectorySortDirection,
  DirectorySortField,
  TransferMode,
  TransferReport,
} from "./types";
import { useDirectoryPane } from "./useDirectoryPane";
import { displayPath } from "./pathDisplay";
import {
  VirtualDirectoryList,
  type DirectoryNavigationDirection,
  type VirtualDirectoryListHandle,
} from "./VirtualDirectoryList";
import { directoryColumnTemplate, type DirectoryListColumn } from "./directoryColumns";
import { VirtualDirectoryGrid } from "./VirtualDirectoryGrid";
import { updateTypeAheadBuffer, type TypeAheadBuffer } from "./typeAhead";

type PaneId = "left" | "right";

const DIRECTORY_COLUMNS: readonly DirectoryListColumn[] = ["name", "type", "size", "modified"];
const DIRECTORY_COLUMN_LABELS: Record<DirectoryListColumn, TranslationKey> = {
  name: "name",
  type: "type",
  size: "size",
  modified: "modified",
};
const NATIVE_DRAG_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAANElEQVRYR+3OMQ0AAAjEMMC/5yFjRxMFfXpm5g5gACN2gAE7wIAdYMAOMGAHGLADfKwBfgGShwM9EKgB0QAAAABJRU5ErkJggg==";
const NATIVE_DRAG_EDGE_MARGIN = 48;
const NATIVE_DRAG_POINT_MAX_AGE_MS = 750;
const MIN_GRID_TILE_WIDTH = 96;
const MAX_GRID_TILE_WIDTH = 256;

function clampGridTileWidth(width: number): number {
  return Math.min(MAX_GRID_TILE_WIDTH, Math.max(MIN_GRID_TILE_WIDTH, Math.round(width / 8) * 8));
}

function clampPreviewWidth(width: number): number {
  return Math.min(520, Math.max(240, Math.round(width)));
}

function initialGridTileWidth(): number {
  try {
    return clampGridTileWidth(Number(window.localStorage.getItem("muller:grid-tile-width")) || 150);
  } catch {
    return 150;
  }
}

function initialPreviewPinned(): boolean {
  try {
    return window.localStorage.getItem("muller:preview-pinned") === "true";
  } catch {
    return false;
  }
}

function fileUri(path: string): string {
  return encodeURI(`file:///${path.replaceAll("\\", "/")}`).replaceAll("#", "%23");
}

function shouldStartNativeFileDrag(): boolean {
  return isTauri() && Reflect.get(globalThis, "__mullerE2eHtmlDrag") !== true;
}

function directoryPathLabel(path: string): string {
  const normalized = displayPath(path).replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? displayPath(path);
}

function DirectoryColumnHeadings({
  columns,
  sortBy,
  sortDirection,
  onSort,
}: {
  columns: readonly DirectoryListColumn[];
  sortBy: DirectorySortField;
  sortDirection: DirectorySortDirection;
  onSort: (column: DirectoryListColumn) => void;
}) {
  const { t } = useAppI18n();
  return (
    <div
      className="directory-column-headings"
      role="row"
      style={{ gridTemplateColumns: directoryColumnTemplate(columns) }}
    >
      {columns.map((column) => (
        <button
          type="button"
          role="columnheader"
          aria-sort={sortBy === column ? sortDirection : "none"}
          data-column={column}
          className={sortBy === column ? "is-sorted" : ""}
          key={column}
          onClick={() => onSort(column)}
        >
          <span>{t(DIRECTORY_COLUMN_LABELS[column])}</span>
          {sortBy === column
            ? sortDirection === "ascending"
              ? <ArrowUp size={12} />
              : <ArrowDown size={12} />
            : null}
        </button>
      ))}
    </div>
  );
}

export interface BrowseNavigationState {
  activePane: PaneId;
  path: string;
  leftPath: string;
  rightPath: string;
  split: boolean;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  selectedName: string | null;
  searchQuery: string;
  searchMode: DirectorySearchMode;
  searchResultCount: number;
  totalEntries: number;
  searchBoth: boolean;
  canSearchBoth: boolean;
}

export interface BrowseWorkspaceHandle {
  navigateActive: (path: string) => void;
  navigatePane: (pane: PaneId, path: string) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  refresh: () => void;
  toggleSplit: () => void;
  moveSelection: (direction: DirectoryNavigationDirection, extend?: boolean) => void;
  selectAll: () => void;
  openSelection: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;
  renameSelection: () => void;
  recycleSelection: () => void;
  togglePreview: () => void;
  activatePane: (pane: PaneId) => void;
  findInDirectory: () => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: DirectorySearchMode) => void;
  setSearchBoth: (enabled: boolean) => void;
  commitSearch: () => void;
}

export interface BrowseComparisonRequest {
  leftPath: string;
  rightPath: string;
  kind: "file" | "directory";
}

interface BrowseWorkspaceProps {
  initialRoot: string;
  routeVisible?: boolean;
  presentation?: DirectoryPresentation;
  filter?: DirectoryQueryFilter;
  paneRatio?: number;
  previewWidth?: number;
  singlePane?: boolean;
  globalSearchRoots?: readonly string[];
  onPaneRatioChange?: (ratio: number) => void;
  onPreviewWidthChange?: (width: number) => void;
  onNavigationChange: (state: BrowseNavigationState) => void;
  onScrollVelocity: (velocity: number) => void;
  onSuccess: (message: string) => void;
  hoverDelayMs?: number;
  operationsCollapsed?: boolean;
  onOperationsCollapsedChange?: (collapsed: boolean) => void;
  onCompareSelection?: (request: BrowseComparisonRequest) => void;
  onComparisonSelectionChange?: (request: BrowseComparisonRequest | null) => void;
  mediaAutoplay?: boolean;
  onMediaAutoplayChange?: (enabled: boolean) => void;
  clipboard?: FileClipboardState | null;
  onClipboardChange?: (clipboard: FileClipboardState | null) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  pane: PaneId;
  entry: DirectoryEntry | null;
}

interface ActiveFileDrag extends InternalFileDrag {
  sourceDirectory: string;
  sourcePaths: string[];
}

function dropDirectoryTarget(target: EventTarget | null): { element: HTMLElement; path: string } | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-drop-directory]");
  const path = element?.dataset.dropDirectory;
  return element && path ? { element, path } : null;
}

function parentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return separator > 2 ? normalized.slice(0, separator) : normalized.slice(0, separator + 1);
}

type PendingConflict =
  | {
      kind: "transfer";
      source: string;
      destinationDirectory: string;
      mode: TransferMode;
    }
  | { kind: "rename"; source: string; newName: string };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : fallback;
}

function isConflict(error: unknown): boolean {
  return errorMessage(error, "").includes("destination already exists");
}

function entryCanMutate(entry: DirectoryEntry | null | undefined): entry is DirectoryEntry {
  return entry?.kind === "file" || entry?.kind === "directory";
}

export const BrowseWorkspace = forwardRef<BrowseWorkspaceHandle, BrowseWorkspaceProps>(
  function BrowseWorkspace(
    {
      initialRoot,
      routeVisible = true,
      presentation = "list",
      filter,
      paneRatio = 50,
      previewWidth = 320,
      singlePane = false,
      globalSearchRoots = [],
      onPaneRatioChange,
      onPreviewWidthChange,
      onNavigationChange,
      onScrollVelocity,
      onSuccess,
      hoverDelayMs = 40,
      operationsCollapsed = false,
      onOperationsCollapsedChange,
      onCompareSelection,
      onComparisonSelectionChange,
      mediaAutoplay = false,
      onMediaAutoplayChange,
      clipboard: controlledClipboard,
      onClipboardChange,
    },
    ref,
  ) {
    const { t, formatNumber } = useAppI18n();
    const [sortBy, setSortBy] = useState<DirectorySortField>("name");
    const [sortDirection, setSortDirection] = useState<DirectorySortDirection>("ascending");
    const [columns, setColumns] = useState<DirectoryListColumn[]>(["name", "size", "modified"]);
    const [columnMenuOpen, setColumnMenuOpen] = useState(false);
    const queryFilter = useMemo<DirectoryQueryFilter>(() => ({
      extensions: filter?.extensions ?? [],
      modifiedBeforeUnixMs: filter?.modifiedBeforeUnixMs ?? null,
      modifiedAfterUnixMs: filter?.modifiedAfterUnixMs ?? null,
      filesOnly: filter?.filesOnly ?? false,
      sortBy,
      sortDirection,
    }), [filter, sortBy, sortDirection]);
    const left = useDirectoryPane(initialRoot, queryFilter, globalSearchRoots);
    const right = useDirectoryPane(initialRoot, queryFilter, globalSearchRoots);
    const panesRef = useRef<HTMLDivElement>(null);
    const browseContentRef = useRef<HTMLDivElement>(null);
    const previewResizerRef = useRef<HTMLButtonElement>(null);
    const previewResizeRef = useRef<{
      pointerId: number;
      startX: number;
      startWidth: number;
      currentWidth: number;
    } | null>(null);
    const previewWidthRef = useRef(clampPreviewWidth(previewWidth));
    const leftListRef = useRef<VirtualDirectoryListHandle>(null);
    const rightListRef = useRef<VirtualDirectoryListHandle>(null);
    const columnMenuRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const [activePane, setActivePane] = useState<PaneId>("left");
    const [split, setSplit] = useState(true);
    const [searchBoth, setSearchBoth] = useState(false);
    const [leftSelection, setLeftSelection] = useState(createSelectionState);
    const [rightSelection, setRightSelection] = useState(createSelectionState);
    const marqueeBaselineRef = useRef<Record<PaneId, SelectionState>>({
      left: createSelectionState(),
      right: createSelectionState(),
    });
    const marqueeAdditiveRef = useRef<Record<PaneId, boolean>>({ left: false, right: false });
    const [internalClipboard, setInternalClipboard] = useState<FileClipboardState | null>(null);
    const clipboard = controlledClipboard === undefined ? internalClipboard : controlledClipboard;
    const setClipboard = useCallback((value: FileClipboardState | null) => {
      if (controlledClipboard === undefined) setInternalClipboard(value);
      onClipboardChange?.(value);
    }, [controlledClipboard, onClipboardChange]);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [busy, setBusy] = useState(false);
    const [transferTaskId, setTransferTaskId] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<DirectoryEntry | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [recycleTarget, setRecycleTarget] = useState<DirectoryEntry[]>([]);
    const [propertiesTarget, setPropertiesTarget] = useState<DirectoryEntry | null>(null);
    const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewPinned, setPreviewPinned] = useState(initialPreviewPinned);
    const [renderedPreviewWidth, setRenderedPreviewWidth] = useState(() => clampPreviewWidth(previewWidth));
    const [gridTileWidth, setGridTileWidth] = useState(initialGridTileWidth);
    const [dropStatus, setDropStatus] = useState<TransferMode | "forbidden" | null>(null);
    const activeDragRef = useRef<ActiveFileDrag | null>(null);
    const nativeDragStartedRef = useRef(false);
    const nativeDragTimerRef = useRef<number | null>(null);
    const lastDragPointRef = useRef<{ x: number; y: number; at: number } | null>(null);
    const dropHighlightRef = useRef<HTMLElement | null>(null);
    const modifierKeysRef = useRef({ ctrlKey: false, shiftKey: false });
    const typeAheadRef = useRef<TypeAheadBuffer>({ buffer: "", lastInputAt: Number.NEGATIVE_INFINITY });
    const typeAheadRevision = useRef(0);
    const visibleSplit = !singlePane && split;
    const canSearchBoth = visibleSplit;

    useEffect(() => {
      if (previewResizeRef.current) return;
      const next = clampPreviewWidth(previewWidth);
      previewWidthRef.current = next;
      setRenderedPreviewWidth(next);
    }, [previewWidth]);

    const active = activePane === "left" ? left : right;
    const activeSelection = activePane === "left" ? leftSelection : rightSelection;
    const selectedEntry = activeSelection.focus === null
      ? null
      : active.entryAt(activeSelection.focus) ?? null;
    const selectedLeftEntry = leftSelection.focus === null
      ? null
      : left.entryAt(leftSelection.focus) ?? null;
    const selectedRightEntry = rightSelection.focus === null
      ? null
      : right.entryAt(rightSelection.focus) ?? null;
    const selectedCount = activeSelection.positions.size;
    const comparisonSelection = useMemo<BrowseComparisonRequest | null>(() => {
      if (!visibleSplit || leftSelection.positions.size !== 1 || rightSelection.positions.size !== 1) return null;
      const leftEntry = leftSelection.focus === null ? undefined : left.entryAt(leftSelection.focus);
      const rightEntry = rightSelection.focus === null ? undefined : right.entryAt(rightSelection.focus);
      if (!leftEntry || !rightEntry || leftEntry.kind !== rightEntry.kind) return null;
      if (leftEntry.kind !== "file" && leftEntry.kind !== "directory") return null;
      return { leftPath: leftEntry.path, rightPath: rightEntry.path, kind: leftEntry.kind };
    }, [left, leftSelection, right, rightSelection, visibleSplit]);

    useEffect(() => {
      onComparisonSelectionChange?.(comparisonSelection);
    }, [comparisonSelection, onComparisonSelectionChange]);


    useEffect(() => {
      if (!searchBoth || canSearchBoth) return;
      setSearchBoth(false);
      if (activePane === "left") right.setSearchQuery("");
      else left.setSearchQuery("");
    }, [activePane, canSearchBoth, left, right, searchBoth]);

    const changeSort = useCallback((column: DirectoryListColumn) => {
      if (sortBy === column) {
        setSortDirection((current) => current === "ascending" ? "descending" : "ascending");
      } else {
        setSortBy(column);
        setSortDirection("ascending");
      }
    }, [sortBy]);

    const toggleColumn = useCallback((column: DirectoryListColumn) => {
      if (column === "name") return;
      setColumns((current) => {
        const enabled = new Set(current);
        if (enabled.has(column)) enabled.delete(column);
        else enabled.add(column);
        return DIRECTORY_COLUMNS.filter((candidate) => enabled.has(candidate));
      });
    }, []);

    useEffect(() => {
      onNavigationChange({
        activePane,
        path: active.state.requestedPath || active.state.path,
        leftPath: left.state.requestedPath || left.state.path,
        rightPath: right.state.requestedPath || right.state.path,
        split: visibleSplit,
        canBack: active.canBack,
        canForward: active.canForward,
        canUp: active.state.parent !== null,
        selectedName: selectedCount > 1
          ? t("selectedCount", { count: formatNumber(selectedCount) })
          : selectedEntry?.name ?? null,
        searchQuery: active.search.query,
        searchMode: active.search.mode,
        searchResultCount: active.visibleTotalEntries,
        totalEntries: active.state.totalEntries,
        searchBoth: searchBoth && canSearchBoth,
        canSearchBoth,
      });
    }, [
      active.canBack,
      active.canForward,
      active.state.parent,
      active.state.path,
      active.state.requestedPath,
      active.state.totalEntries,
      active.search.query,
      active.search.mode,
      active.visibleTotalEntries,
      activePane,
      canSearchBoth,
      left.state.path,
      left.state.requestedPath,
      onNavigationChange,
      right.state.path,
      right.state.requestedPath,
      selectedEntry?.name,
      selectedCount,
      searchBoth,
      visibleSplit,
      formatNumber,
      t,
    ]);

    useEffect(() => setLeftSelection(createSelectionState()), [left.search.query, left.state.path]);
    useEffect(() => setRightSelection(createSelectionState()), [right.search.query, right.state.path]);
    useEffect(() => {
      if (left.visibleTotalEntries <= 0) return;
      setLeftSelection((current) => current.focus === null
        ? selectPosition(
            current,
            0,
            left.visibleTotalEntries,
            { ctrl: false, shift: false },
            left.entryAt(0)?.path,
          )
        : current);
    }, [left.search.query, left.state.path, left.visibleTotalEntries]);
    useEffect(() => {
      if (right.visibleTotalEntries <= 0) return;
      setRightSelection((current) => current.focus === null
        ? selectPosition(
            current,
            0,
            right.visibleTotalEntries,
            { ctrl: false, shift: false },
            right.entryAt(0)?.path,
          )
        : current);
    }, [right.search.query, right.state.path, right.visibleTotalEntries]);
    const setPaneSelection = useCallback(
      (pane: PaneId, update: (current: SelectionState) => SelectionState) => {
        if (pane === "left") setLeftSelection(update);
        else setRightSelection(update);
      },
      [],
    );

    useEffect(() => {
      const handleTypeAhead = (event: KeyboardEvent) => {
        if (
          event.isComposing
          || event.ctrlKey
          || event.altKey
          || event.metaKey
          || event.key.length !== 1
          || !event.key.trim()
        ) return;
        const element = event.target instanceof HTMLElement ? event.target : null;
        if (!element?.closest(".directory-list-viewport, .directory-grid-viewport")) return;
        if (element.closest("input, textarea, [contenteditable=true], .cm-editor")) return;
        event.preventDefault();
        const next = updateTypeAheadBuffer(typeAheadRef.current, event.key, performance.now());
        typeAheadRef.current = next.state;
        const revision = ++typeAheadRevision.current;
        const target = activePane === "left" ? left : right;
        const selection = activePane === "left" ? leftSelection : rightSelection;
        void target.locate(next.query, selection.focus).then((result) => {
          if (!result || revision !== typeAheadRevision.current) return;
          setPaneSelection(activePane, (current) => selectPosition(
            current,
            result.position,
            target.visibleTotalEntries,
            { ctrl: false, shift: false },
            result.path,
          ));
          (activePane === "left" ? leftListRef : rightListRef).current?.scrollToPosition(result.position);
        }).catch(() => undefined);
      };
      window.addEventListener("keydown", handleTypeAhead);
      return () => window.removeEventListener("keydown", handleTypeAhead);
    }, [activePane, left, leftSelection, right, rightSelection, setPaneSelection]);

    const handleSelect = useCallback((
      pane: PaneId,
      position: number,
      modifiers: SelectionModifiers,
    ) => {
      const target = pane === "left" ? left : right;
      setActivePane(pane);
      setPaneSelection(pane, (current) => selectPosition(
        current,
        position,
        target.visibleTotalEntries,
        modifiers,
        target.entryAt(position)?.path,
      ));
    }, [left, right, setPaneSelection]);

    const clearSelection = useCallback((pane: PaneId) => {
      setPaneSelection(pane, () => createSelectionState());
    }, [setPaneSelection]);

    const startMarquee = useCallback((pane: PaneId, modifiers: SelectionModifiers) => {
      const current = pane === "left" ? leftSelection : rightSelection;
      marqueeBaselineRef.current[pane] = current;
      marqueeAdditiveRef.current[pane] = modifiers.ctrl || modifiers.shift;
    }, [leftSelection, rightSelection]);

    const changeMarquee = useCallback((pane: PaneId, positions: ReadonlySet<number>) => {
      const target = pane === "left" ? left : right;
      setPaneSelection(pane, () => applyMarqueeSelection(
        marqueeBaselineRef.current[pane],
        positions,
        marqueeAdditiveRef.current[pane],
        target.visibleTotalEntries,
      ));
    }, [left, right, setPaneSelection]);

    const resolvedSelectedEntries = useCallback(async (
      pane = activePane,
    ): Promise<DirectoryEntry[]> => {
      const target = pane === "left" ? left : right;
      const selection = pane === "left" ? leftSelection : rightSelection;
      const positions = [...selection.positions].sort((a, b) => a - b);
      return target.resolveEntries(positions);
    }, [activePane, left, leftSelection, right, rightSelection]);

    useEffect(() => {
      if (!contextMenu) return;
      const close = () => setContextMenu(null);
      const escape = (event: KeyboardEvent) => {
        if (event.key === "Escape") close();
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", escape);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", escape);
      };
    }, [contextMenu]);

    useLayoutEffect(() => {
      const menu = contextMenuRef.current;
      if (!menu || !contextMenu) return;
      const bounds = menu.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const x = Math.min(
        Math.max(contextMenu.x, viewportLeft + 8),
        Math.max(viewportLeft + 8, viewportRight - bounds.width - 8),
      );
      const y = Math.min(
        Math.max(contextMenu.y, viewportTop + 8),
        Math.max(viewportTop + 8, viewportBottom - bounds.height - 8),
      );
      if (Math.abs(x - contextMenu.x) < 0.5 && Math.abs(y - contextMenu.y) < 0.5) return;
      setContextMenu((current) => current ? {
        ...current,
        x,
        y,
      } : null);
    }, [contextMenu]);

    useEffect(() => {
      if (!columnMenuOpen) return;
      const close = (event: PointerEvent) => {
        if (!columnMenuRef.current?.contains(event.target as Node)) setColumnMenuOpen(false);
      };
      const escape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setColumnMenuOpen(false);
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", escape);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", escape);
      };
    }, [columnMenuOpen]);

    const refreshBoth = useCallback(() => {
      left.refresh();
      right.refresh();
    }, [left, right]);

    const syncOtherPane = useCallback(() => {
      if (!visibleSplit) return;
      const sourcePath = active.state.requestedPath || active.state.path;
      if (!sourcePath) return;
      const destination = activePane === "left" ? right : left;
      void destination.openPath(sourcePath);
      setNotice(t("paneSynced", { name: activePane === "left" ? "RIGHT" : "LEFT" }));
      setError(null);
    }, [active.state.path, active.state.requestedPath, activePane, left, right, t, visibleSplit]);

    const activatePaneWithFocus = useCallback(
      (pane: PaneId) => {
        if (!visibleSplit) return;
        setActivePane(pane);
        window.requestAnimationFrame(() =>
          (pane === "left" ? leftListRef : rightListRef).current?.focus(),
        );
      },
      [visibleSplit],
    );

    useEffect(() => {
      const handlePaneTab = (event: KeyboardEvent) => {
        if (!visibleSplit || event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
        const element = event.target instanceof HTMLElement ? event.target : null;
        if (!element?.closest(".directory-list-viewport, .directory-grid-viewport")) return;
        event.preventDefault();
        activatePaneWithFocus(activePane === "left" ? "right" : "left");
      };
      window.addEventListener("keydown", handlePaneTab);
      return () => window.removeEventListener("keydown", handlePaneTab);
    }, [activatePaneWithFocus, activePane, visibleSplit]);

    const changeGridTileWidth = useCallback((width: number) => {
      const next = clampGridTileWidth(width);
      setGridTileWidth(next);
      try {
        window.localStorage.setItem("muller:grid-tile-width", String(next));
      } catch {
        // Browsing still works when storage is unavailable.
      }
    }, []);

    const finishReport = useCallback(
      (report: TransferReport, mode: TransferMode | "rename") => {
        if (mode === "move" && report.outcome === "moved" && !report.sourceRetained) {
          setClipboard(null);
        }
        const operation = t(report.outcome === "skipped" ? "skipped" : report.outcome);
        const message = report.warning ?? t("operationDestination", { operation, destination: displayPath(report.destination) });
        setNotice(message);
        setError(null);
        onSuccess(message);
        refreshBoth();
      },
      [onSuccess, refreshBoth, t],
    );

    const performTransfer = useCallback(
      async (
        source: string,
        destinationDirectory: string,
        mode: TransferMode,
        conflict: ConflictStrategy,
      ) => {
        if (busy) return;
        setBusy(true);
        setContextMenu(null);
        try {
          const report = await transferEntry(
            source,
            destinationDirectory,
            mode,
            conflict,
            setTransferTaskId,
          );
          setPendingConflict(null);
          finishReport(report, mode);
        } catch (operationError) {
          if (conflict === "fail" && isConflict(operationError)) {
            setPendingConflict({ kind: "transfer", source, destinationDirectory, mode });
          } else {
            setError(errorMessage(operationError, t("unableTransfer")));
          }
        } finally {
          setBusy(false);
        }
      },
      [busy, finishReport, t],
    );

    const clearDropState = useCallback(() => {
      dropHighlightRef.current?.classList.remove("is-file-drop-target", "is-file-drop-forbidden");
      dropHighlightRef.current = null;
      setDropStatus(null);
    }, []);

    const cancelNativeDragTakeover = useCallback(() => {
      if (nativeDragTimerRef.current !== null) window.clearTimeout(nativeDragTimerRef.current);
      nativeDragTimerRef.current = null;
    }, []);

    const rememberDragPoint = useCallback((event: Pick<DragEvent, "clientX" | "clientY">) => {
      const { clientX: x, clientY: y } = event;
      if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;
      lastDragPointRef.current = { x, y, at: performance.now() };
    }, []);

    const fileDragEnd = useCallback(() => {
      cancelNativeDragTakeover();
      activeDragRef.current = null;
      nativeDragStartedRef.current = false;
      lastDragPointRef.current = null;
      clearDropState();
    }, [cancelNativeDragTakeover, clearDropState]);

    const showDropTarget = useCallback((element: HTMLElement, status: TransferMode | "forbidden") => {
      if (dropHighlightRef.current !== element) {
        dropHighlightRef.current?.classList.remove("is-file-drop-target", "is-file-drop-forbidden");
        dropHighlightRef.current = element;
      }
      element.classList.toggle("is-file-drop-target", status !== "forbidden");
      element.classList.toggle("is-file-drop-forbidden", status === "forbidden");
      setDropStatus((current) => current === status ? current : status);
    }, []);

    const fileDragStart = useCallback((
      pane: PaneId,
      event: ReactDragEvent<HTMLElement>,
      entry: DirectoryEntry,
      position: number,
    ) => {
      const target = pane === "left" ? left : right;
      const selection = pane === "left" ? leftSelection : rightSelection;
      const sourceSessionId = target.state.sessionId;
      if (sourceSessionId === null || !entryCanMutate(entry)) {
        event.preventDefault();
        return;
      }
      const positions = selection.positions.has(position)
        ? [...selection.positions].sort((a, b) => a - b)
        : [position];
      if (!selection.positions.has(position)) {
        handleSelect(pane, position, { ctrl: false, shift: false });
      }
      const payload: InternalFileDrag = {
        version: 1,
        sourceSessionId,
        sourcePane: pane,
        query: target.search.query,
        positions,
      };
      const sourcePaths = positions.flatMap((selectedPosition) => {
        const selected = target.entryAt(selectedPosition);
        return selected ? [selected.path] : [];
      });
      activeDragRef.current = {
        ...payload,
        sourceDirectory: target.state.path,
        sourcePaths: sourcePaths.length > 0 ? sourcePaths : [entry.path],
      };
      rememberDragPoint(event);
      const nativePaths = activeDragRef.current.sourcePaths;
      if (shouldStartNativeFileDrag()) {
        event.preventDefault();
        nativeDragStartedRef.current = true;
        void startDrag({
          item: nativePaths,
          icon: NATIVE_DRAG_ICON,
          mode: event.ctrlKey ? "copy" : "move",
        }, fileDragEnd).catch((dragError) => {
          setError(errorMessage(dragError, t("unableTransfer")));
          fileDragEnd();
        });
        return;
      }
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", positions.length === 1 ? entry.name : t("itemCount", { count: formatNumber(positions.length) }));
      event.dataTransfer.setData("text/uri-list", nativePaths.map(fileUri).join("\r\n"));
    }, [fileDragEnd, formatNumber, handleSelect, left, leftSelection, rememberDragPoint, right, rightSelection, t]);

    const resolveActiveDrag = useCallback((event: DragEvent): ActiveFileDrag | null => {
      if (activeDragRef.current) return activeDragRef.current;
      const serialized = event.dataTransfer?.getData(INTERNAL_FILE_DRAG_MIME);
      const payload = serialized ? parseInternalFileDrag(serialized) : null;
      if (!payload) return null;
      const source = payload.sourcePane === "left" ? left : right;
      if (source.state.sessionId !== payload.sourceSessionId) return null;
      const restored: ActiveFileDrag = {
        ...payload,
        sourceDirectory: source.state.path,
        sourcePaths: payload.positions.flatMap((position) => {
          const entry = source.entryAt(position);
          return entryCanMutate(entry) ? [entry.path] : [];
        }),
      };
      activeDragRef.current = restored;
      return restored;
    }, [left, right]);

    const beginNativeDragOutsideWindow = useCallback((event: DragEvent) => {
      const payload = activeDragRef.current;
      const outsideWindow = event.clientX <= 1
          || event.clientY <= 1
          || event.clientX >= window.innerWidth - 1
          || event.clientY >= window.innerHeight - 1;
      const lastPoint = lastDragPointRef.current;
      const recentlyApproachedEdge = lastPoint !== null
        && performance.now() - lastPoint.at <= NATIVE_DRAG_POINT_MAX_AGE_MS
        && ((event.clientX <= 1 && lastPoint.x <= NATIVE_DRAG_EDGE_MARGIN)
          || (event.clientY <= 1 && lastPoint.y <= NATIVE_DRAG_EDGE_MARGIN)
          || (event.clientX >= window.innerWidth - 1 && lastPoint.x >= window.innerWidth - NATIVE_DRAG_EDGE_MARGIN)
          || (event.clientY >= window.innerHeight - 1 && lastPoint.y >= window.innerHeight - NATIVE_DRAG_EDGE_MARGIN));
      if (!isTauri() || !payload || payload.sourcePaths.length === 0 || nativeDragStartedRef.current || nativeDragTimerRef.current !== null || !outsideWindow || !recentlyApproachedEdge) return;
      const mode = event.ctrlKey ? "copy" : "move";
      nativeDragStartedRef.current = true;
      void startDrag({
        item: payload.sourcePaths,
        icon: NATIVE_DRAG_ICON,
        mode,
      }, fileDragEnd).catch((dragError) => {
        setError(errorMessage(dragError, t("unableTransfer")));
        fileDragEnd();
      });
    }, [fileDragEnd, t]);

    const performSessionDrop = useCallback(async (
      payload: ActiveFileDrag,
      destinationDirectory: string,
      mode: TransferMode,
    ) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await transferDirectoryEntries(
          payload.sourceSessionId,
          payload.query,
          payload.positions,
          destinationDirectory,
          mode,
          "keep_both",
          setTransferTaskId,
        );
        const completed = result.reports.length;
        const summary = t("transferredItems", { operation: t(mode === "copy" ? "copied" : "moved"), count: formatNumber(completed) });
        setNotice(summary);
        setError(result.failures.length > 0
          ? t("transferFailures", { count: formatNumber(result.failures.length) })
          : null);
        if (completed > 0) onSuccess(summary);
        refreshBoth();
      } catch (operationError) {
        setError(errorMessage(operationError, t("unableTransferDropped")));
      } finally {
        setBusy(false);
      }
    }, [busy, formatNumber, onSuccess, refreshBoth, t]);

    const performExternalDrop = useCallback(async (
      paths: readonly string[],
      destinationDirectory: string,
      modifiers: { ctrlKey: boolean; shiftKey: boolean },
    ) => {
      if (busy || paths.length === 0) return;
      setBusy(true);
      setError(null);
      let completed = 0;
      let failed = 0;
      try {
        for (const source of [...new Set(paths)]) {
          if (pathsMatch(parentPath(source), destinationDirectory)) {
            failed += 1;
            continue;
          }
          try {
            await transferEntry(
              source,
              destinationDirectory,
              transferModeForDrop(source, destinationDirectory, modifiers),
              "keep_both",
              setTransferTaskId,
            );
            completed += 1;
          } catch {
            failed += 1;
          }
        }
        const summary = t("importedItems", { count: formatNumber(completed) });
        setNotice(summary);
        setError(failed > 0 ? t("transferFailures", { count: formatNumber(failed) }) : null);
        if (completed > 0) onSuccess(summary);
        refreshBoth();
      } finally {
        setBusy(false);
      }
    }, [busy, formatNumber, onSuccess, refreshBoth, t]);

    const performRename = useCallback(
      async (source: string, newName: string, conflict: ConflictStrategy) => {
        if (busy) return;
        setBusy(true);
        try {
          const report = await renameEntry(source, newName, conflict);
          setRenameTarget(null);
          setPendingConflict(null);
          finishReport(report, "rename");
        } catch (operationError) {
          if (conflict === "fail" && isConflict(operationError)) {
            setRenameTarget(null);
            setPendingConflict({ kind: "rename", source, newName });
          } else {
            setError(errorMessage(operationError, t("unableRename")));
          }
        } finally {
          setBusy(false);
        }
      },
      [busy, finishReport, t],
    );

    const copyOrCut = useCallback(async (
      mode: TransferMode,
      explicitEntry?: DirectoryEntry | null,
    ) => {
      const entries = explicitEntry
        ? [explicitEntry]
        : await resolvedSelectedEntries();
      const mutable = entries.filter(entryCanMutate);
      if (mutable.length === 0) return;
      setClipboard({ mode, entries: mutable });
      setNotice(
        mutable.length === 1
          ? t("clipboardEntry", { operation: t(mode === "copy" ? "copied" : "cut"), name: mutable[0]?.name ?? t("item") })
          : t("clipboardItems", { operation: t(mode === "copy" ? "copied" : "cut"), count: formatNumber(mutable.length) }),
      );
      setError(null);
      setContextMenu(null);
    }, [formatNumber, resolvedSelectedEntries, t]);

    const pasteTo = useCallback(
      async (destinationDirectory = active.state.path) => {
        if (!clipboard || !destinationDirectory) return;
        if (clipboard.entries.length === 1) {
          const entry = clipboard.entries[0];
          if (entry) {
            await performTransfer(entry.path, destinationDirectory, clipboard.mode, "fail");
          }
          return;
        }
        if (busy) return;
        setBusy(true);
        setContextMenu(null);
        const failed: DirectoryEntry[] = [];
        let succeeded = 0;
        try {
          for (const entry of clipboard.entries) {
            try {
              await transferEntry(
                entry.path,
                destinationDirectory,
                clipboard.mode,
                "fail",
                setTransferTaskId,
              );
              succeeded += 1;
            } catch {
              failed.push(entry);
            }
          }
          const operation = t(clipboard.mode === "copy" ? "copied" : "moved");
          const summary = failed.length > 0
            ? t("partialTransfer", { operation, count: formatNumber(succeeded), failed: formatNumber(failed.length) })
            : t("transferredItems", { operation, count: formatNumber(succeeded) });
          setNotice(summary);
          setError(failed.length > 0 ? t("partialTransferError") : null);
          onSuccess(summary);
          if (clipboard.mode === "move") {
            setClipboard(failed.length > 0 ? { ...clipboard, entries: failed } : null);
          }
          refreshBoth();
        } finally {
          setBusy(false);
        }
      },
      [active.state.path, busy, clipboard, formatNumber, onSuccess, performTransfer, refreshBoth, t],
    );

    const openEntry = useCallback(
      (pane: PaneId, entry: DirectoryEntry) => {
        setActivePane(pane);
        setContextMenu(null);
        if (entry.kind === "directory") {
          void (pane === "left" ? left.openPath(entry.path) : right.openPath(entry.path));
        } else if (entry.kind === "file") {
          void openNativePath(entry.path)
            .then((outcome) => {
              if (outcome === "chooser_cancelled") setNotice(t("openCancelled"));
              setError(null);
            })
            .catch((openError) => {
              setError(errorMessage(openError, t("unableOpenEntry")));
            });
        }
      },
      [left, right, t],
    );

    const openEntryWith = useCallback((entry: DirectoryEntry) => {
      if (entry.kind !== "file") return;
      setContextMenu(null);
      void openNativePath(entry.path, true)
        .then((outcome) => {
          setNotice(outcome === "chooser_cancelled" ? t("openCancelled") : t("openedEntry", { name: entry.name }));
          setError(null);
        })
        .catch((openError) => {
          setError(errorMessage(openError, t("unableOpenWith")));
        });
    }, [t]);

    const beginRename = useCallback((entry = selectedEntry) => {
      if (selectedCount !== 1 && entry === selectedEntry) return;
      if (!entryCanMutate(entry)) return;
      setContextMenu(null);
      setError(null);
      setRenameValue(entry.name);
      setRenameTarget(entry);
    }, [selectedCount, selectedEntry]);

    const beginRecycle = useCallback(async (entry?: DirectoryEntry | null) => {
      const entries = entry ? [entry] : await resolvedSelectedEntries();
      const mutable = entries.filter(entryCanMutate);
      if (mutable.length === 0) return;
      setContextMenu(null);
      setError(null);
      setRecycleTarget(mutable);
    }, [resolvedSelectedEntries]);

    const createNewEntry = useCallback(async (
      pane: PaneId,
      kind: "directory" | "text_file" | "empty_file",
    ) => {
      if (busy) return;
      const target = pane === "left" ? left : right;
      setBusy(true);
      setContextMenu(null);
      try {
        const path = await createEntry(target.state.path, kind);
        const name = path.split(/[\\/]/).at(-1) ?? path;
        target.refresh();
        setRenameValue(name);
        setRenameTarget({
          path,
          name,
          kind: kind === "directory" ? "directory" : "file",
          extension: kind === "text_file" ? "txt" : null,
          size: 0,
          modifiedUnixMs: null,
          hidden: false,
        });
      } catch (operationError) {
        setError(errorMessage(operationError, t("unableCreateEntry")));
      } finally {
        setBusy(false);
      }
    }, [busy, left, right, t]);

    const copyText = useCallback(async (value: string, label: string) => {
      setContextMenu(null);
      try {
        await navigator.clipboard.writeText(value);
        setNotice(label);
      } catch (copyError) {
        setError(errorMessage(copyError, t("unableClipboard")));
      }
    }, [t]);

    const compressSelection = useCallback(async (pane: PaneId) => {
      if (busy) return;
      const target = pane === "left" ? left : right;
      setBusy(true);
      setContextMenu(null);
      try {
        const entries = await resolvedSelectedEntries(pane);
        const path = await createZip(entries.filter(entryCanMutate).map((entry) => entry.path), target.state.path, setTransferTaskId);
        setNotice(t("createdPath", { path: displayPath(path) }));
        onSuccess(t("createdZip", { path: displayPath(path) }));
        target.refresh();
      } catch (operationError) {
        setError(errorMessage(operationError, t("unableCreateZip")));
      } finally {
        setBusy(false);
      }
    }, [busy, left, onSuccess, resolvedSelectedEntries, right, t]);

    const extractArchive = useCallback(async (
      pane: PaneId,
      entry: DirectoryEntry,
      mode: "current" | "named",
      chosenDestination?: string,
    ) => {
      if (busy) return;
      const target = pane === "left" ? left : right;
      setBusy(true);
      setContextMenu(null);
      try {
        const destination = chosenDestination ?? target.state.path;
        const path = await extractZip(entry.path, destination, mode, setTransferTaskId);
        setNotice(t("extractedPath", { path: displayPath(path) }));
        onSuccess(t("extractedZip", { path: displayPath(path) }));
        target.refresh();
      } catch (operationError) {
        setError(errorMessage(operationError, t("unableExtractZip")));
      } finally {
        setBusy(false);
      }
    }, [busy, left, onSuccess, right, t]);

    const chooseArchiveDestination = useCallback(async (pane: PaneId, entry: DirectoryEntry) => {
      const target = pane === "left" ? left : right;
      const selection = await open({
        directory: true,
        multiple: false,
        defaultPath: target.state.path,
        title: t("chooseExtractionDestination"),
      });
      if (typeof selection === "string") await extractArchive(pane, entry, "current", selection);
    }, [extractArchive, left, right, t]);

    const showTerminal = useCallback((path: string) => {
      setContextMenu(null);
      void openTerminal(path).catch((operationError) => setError(errorMessage(operationError, t("unableOpenTerminal"))));
    }, [t]);

    const confirmRecycle = useCallback(async () => {
      if (recycleTarget.length === 0 || busy) return;
      setBusy(true);
      let succeeded = 0;
      const failed: DirectoryEntry[] = [];
      try {
        for (const entry of recycleTarget) {
          try {
            await recycleEntry(entry);
            succeeded += 1;
          } catch {
            failed.push(entry);
          }
        }
        const summary = t("recycledItems", { count: formatNumber(succeeded) });
        setNotice(summary);
        setRecycleTarget(failed);
        setError(failed.length > 0 ? t("recycleFailures", { count: formatNumber(failed.length) }) : null);
        if (succeeded > 0) onSuccess(summary);
        refreshBoth();
      } catch (operationError) {
        setError(errorMessage(operationError, t("unableRecycleEntry")));
      } finally {
        setBusy(false);
      }
    }, [busy, formatNumber, onSuccess, recycleTarget, refreshBoth, t]);

    const moveSelection = useCallback(
      (direction: DirectoryNavigationDirection, extend = false) => {
        const target = activePane === "left" ? left : right;
        const list = activePane === "left" ? leftListRef : rightListRef;
        const selection = activePane === "left" ? leftSelection : rightSelection;
        const position = list.current?.navigationTarget(selection.focus, direction) ?? -1;
        if (position < 0) return;
        setPaneSelection(activePane, (current) => moveSelectionFocus(
          current,
          position,
          target.visibleTotalEntries,
          extend,
          target.entryAt(position)?.path,
        ));
        list.current?.scrollToPosition(position);
      },
      [activePane, left, leftSelection, right, rightSelection, setPaneSelection],
    );

    const handleContextMenu = useCallback(
      (
        pane: PaneId,
        event: ReactMouseEvent<HTMLElement>,
        entry: DirectoryEntry | null,
        position: number | null,
      ) => {
        event.preventDefault();
        setActivePane(pane);
        if (position !== null) {
          const selection = pane === "left" ? leftSelection : rightSelection;
          if (!selection.positions.has(position)) {
            handleSelect(pane, position, { ctrl: false, shift: false });
          }
        }
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          pane,
          entry,
        });
      },
      [handleSelect, leftSelection, rightSelection],
    );

    const isLegalInternalDrop = useCallback((payload: ActiveFileDrag, destination: string) => {
      const destinationIdentity = pathIdentity(destination);
      return !busy
        && !pathsMatch(payload.sourceDirectory, destination)
        && !payload.sourcePaths.some((source) => {
          const sourceIdentity = pathIdentity(source);
          return destinationIdentity === sourceIdentity
            || destinationIdentity.startsWith(`${sourceIdentity}\\`);
        });
    }, [busy]);

    useEffect(() => {
      const onDragOver = (event: DragEvent) => {
        cancelNativeDragTakeover();
        rememberDragPoint(event);
        const payload = resolveActiveDrag(event);
        if (!payload) return;
        const target = dropDirectoryTarget(event.target);
        if (!target) {
          clearDropState();
          return;
        }
        event.preventDefault();
        const legal = isLegalInternalDrop(payload, target.path);
        const mode = transferModeForDrop(payload.sourceDirectory, target.path, event);
        if (event.dataTransfer) event.dataTransfer.dropEffect = legal ? mode : "none";
        showDropTarget(target.element, legal ? mode : "forbidden");
      };
      const onDragEnter = (event: DragEvent) => {
        cancelNativeDragTakeover();
        rememberDragPoint(event);
      };
      const onDragMove = (event: DragEvent) => rememberDragPoint(event);
      const onDrop = (event: DragEvent) => {
        const payload = resolveActiveDrag(event);
        if (!payload) return;
        const target = dropDirectoryTarget(event.target);
        event.preventDefault();
        if (target && isLegalInternalDrop(payload, target.path)) {
          const mode = transferModeForDrop(payload.sourceDirectory, target.path, event);
          void performSessionDrop(payload, target.path, mode);
        }
        activeDragRef.current = null;
        clearDropState();
      };
      window.addEventListener("dragover", onDragOver, true);
      window.addEventListener("dragenter", onDragEnter, true);
      window.addEventListener("drag", onDragMove, true);
      window.addEventListener("drop", onDrop, true);
      window.addEventListener("dragend", fileDragEnd, true);
      window.addEventListener("dragleave", beginNativeDragOutsideWindow, true);
      return () => {
        window.removeEventListener("dragover", onDragOver, true);
        window.removeEventListener("dragenter", onDragEnter, true);
        window.removeEventListener("drag", onDragMove, true);
        window.removeEventListener("drop", onDrop, true);
        window.removeEventListener("dragend", fileDragEnd, true);
        window.removeEventListener("dragleave", beginNativeDragOutsideWindow, true);
      };
    }, [beginNativeDragOutsideWindow, cancelNativeDragTakeover, clearDropState, fileDragEnd, isLegalInternalDrop, performSessionDrop, rememberDragPoint, resolveActiveDrag, showDropTarget]);

    useEffect(() => {
      const updateModifiers = (event: KeyboardEvent) => {
        modifierKeysRef.current = { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey };
      };
      const clearModifiers = () => {
        modifierKeysRef.current = { ctrlKey: false, shiftKey: false };
      };
      window.addEventListener("keydown", updateModifiers);
      window.addEventListener("keyup", updateModifiers);
      window.addEventListener("blur", clearModifiers);
      return () => {
        window.removeEventListener("keydown", updateModifiers);
        window.removeEventListener("keyup", updateModifiers);
        window.removeEventListener("blur", clearModifiers);
      };
    }, []);

    useEffect(() => {
      if (!isTauri()) return;
      let disposed = false;
      let unlisten: (() => void) | undefined;
      let externalPaths: string[] = [];
      const targetAt = (x: number, y: number) => {
        const scale = window.devicePixelRatio || 1;
        return dropDirectoryTarget(document.elementFromPoint(x / scale, y / scale));
      };
      const handleDropEvent = (event: TauriEvent<DragDropEvent>) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          externalPaths = [];
          clearDropState();
          return;
        }
        if (payload.type === "enter") externalPaths = payload.paths;
        const target = targetAt(payload.position.x, payload.position.y);
        if (!target) {
          clearDropState();
          return;
        }
        const source = (payload.type === "drop" ? payload.paths : externalPaths)[0];
        const legal = Boolean(source) && !pathsMatch(parentPath(source ?? ""), target.path) && !busy;
        const mode = source
          ? transferModeForDrop(source, target.path, modifierKeysRef.current)
          : "copy";
        showDropTarget(target.element, legal ? mode : "forbidden");
        if (payload.type === "drop") {
          if (legal) void performExternalDrop(payload.paths, target.path, modifierKeysRef.current);
          externalPaths = [];
          clearDropState();
        }
      };
      let webview: ReturnType<typeof getCurrentWebview>;
      try {
        webview = getCurrentWebview();
      } catch {
        clearDropState();
        return;
      }
      void webview.onDragDropEvent(handleDropEvent).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch(() => clearDropState());
      return () => {
        disposed = true;
        unlisten?.();
        clearDropState();
      };
    }, [busy, clearDropState, performExternalDrop, showDropTarget]);

    useImperativeHandle(ref, () => ({
      navigateActive(path) {
        void active.openPath(path);
      },
      navigatePane(pane, path) {
        setActivePane(pane);
        void (pane === "left" ? left : right).openPath(path);
      },
      back: active.back,
      forward: active.forward,
      up: active.up,
      refresh: active.refresh,
      toggleSplit() {
        if (singlePane) return;
        setSplit((current) => !current);
      },
      moveSelection,
      selectAll() {
        setPaneSelection(activePane, (current) => selectAllPositions(
          current,
          active.visibleTotalEntries,
        ));
      },
      openSelection() {
        if (selectedEntry) openEntry(activePane, selectedEntry);
      },
      copySelection() {
        void copyOrCut("copy");
      },
      cutSelection() {
        void copyOrCut("move");
      },
      paste() {
        void pasteTo();
      },
      renameSelection: beginRename,
      recycleSelection() {
        void beginRecycle();
      },
      togglePreview() {
        setPreviewOpen((current) => !current);
      },
      activatePane: activatePaneWithFocus,
      findInDirectory() {
        window.dispatchEvent(new Event("muller:focus-directory-search"));
      },
      setSearchQuery(query) {
        if (searchBoth && canSearchBoth) {
          left.setSearchQuery(query);
          right.setSearchQuery(query);
        } else {
          active.setSearchQuery(query);
        }
      },
      setSearchMode(mode) {
        if (searchBoth && canSearchBoth) {
          left.setSearchMode(mode);
          right.setSearchMode(mode);
        } else {
          active.setSearchMode(mode);
        }
      },
      setSearchBoth(enabled) {
        const next = enabled && canSearchBoth;
        setSearchBoth(next);
        if (next) {
          const query = active.search.query;
          const mode = active.search.mode;
          left.setSearchMode(mode);
          right.setSearchMode(mode);
          left.setSearchQuery(query);
          right.setSearchQuery(query);
        } else if (activePane === "left") {
          right.setSearchQuery("");
        } else {
          left.setSearchQuery("");
        }
      },
      commitSearch() {
        if (active.visibleTotalEntries > 0) {
          setPaneSelection(activePane, (current) => selectPosition(
            current,
            0,
            active.visibleTotalEntries,
            { ctrl: false, shift: false },
            active.entryAt(0)?.path,
          ));
          (activePane === "left" ? leftListRef : rightListRef).current?.scrollToPosition(0);
        }
        window.requestAnimationFrame(() =>
          (activePane === "left" ? leftListRef : rightListRef).current?.focus(),
        );
      },
    }));

    const menuEntry = contextMenu?.entry ?? null;
    const menuPane = contextMenu?.pane === "right" ? right : left;
    const pasteDestination = menuEntry?.kind === "directory" ? menuEntry.path : menuPane.state.path;
    const updatePaneRatio = (clientX: number) => {
      const bounds = panesRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0) return;
      onPaneRatioChange?.(((clientX - bounds.left) / bounds.width) * 100);
    };
    const finishPreviewResize = useCallback((commit: boolean) => {
      const drag = previewResizeRef.current;
      if (!drag) return;
      previewResizeRef.current = null;
      const resizer = previewResizerRef.current;
      if (resizer?.hasPointerCapture(drag.pointerId)) {
        resizer.releasePointerCapture(drag.pointerId);
      }
      if (commit) onPreviewWidthChange?.(drag.currentWidth);
    }, [onPreviewWidthChange]);

    useEffect(() => {
      const move = (event: PointerEvent) => {
        const drag = previewResizeRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if ((event.buttons & 1) === 0) {
          finishPreviewResize(true);
          return;
        }
        const next = clampPreviewWidth(drag.startWidth + drag.startX - event.clientX);
        drag.currentWidth = next;
        previewWidthRef.current = next;
        setRenderedPreviewWidth(next);
      };
      const finishPointer = (event: PointerEvent) => {
        if (previewResizeRef.current?.pointerId === event.pointerId) finishPreviewResize(true);
      };
      const finish = () => finishPreviewResize(true);
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", finishPointer, true);
      window.addEventListener("pointercancel", finishPointer, true);
      window.addEventListener("mouseup", finish, true);
      window.addEventListener("blur", finish);
      return () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", finishPointer, true);
        window.removeEventListener("pointercancel", finishPointer, true);
        window.removeEventListener("mouseup", finish, true);
        window.removeEventListener("blur", finish);
        finishPreviewResize(false);
      };
    }, [finishPreviewResize]);

    return (
      <section className={`browse-workspace${operationsCollapsed ? " is-actions-collapsed" : ""}`} aria-label={t("fileBrowser")} hidden={!routeVisible}>
        {dropStatus ? (
          <div className={`file-drop-status is-${dropStatus}`} role="status" aria-live="polite">
            {dropStatus === "copy" ? <Copy size={15} /> : dropStatus === "move" ? <Scissors size={15} /> : <X size={15} />}
            <span>{dropStatus === "copy" ? t("copyHere") : dropStatus === "move" ? t("moveHere") : t("cannotDrop")}</span>
          </div>
        ) : null}
        {!operationsCollapsed ? <div className="browse-toolbar">
          <div className="browse-actions">
            <button className="icon-button mobile-optional" type="button" title={t("openSelected")} aria-label={t("openSelected")} disabled={!selectedEntry} onClick={() => selectedEntry && openEntry(activePane, selectedEntry)}>
              <FolderInput size={15} />
            </button>
            <button className="icon-button" type="button" title={t("refresh")} aria-label={t("refresh")} onClick={active.refresh}>
              <RefreshCw size={15} />
            </button>
            <button className="icon-button" type="button" title={t("copy")} aria-label={t("copy")} disabled={selectedCount === 0} onClick={() => void copyOrCut("copy")}>
              <Copy size={15} />
            </button>
            <button className="icon-button" type="button" title={t("cut")} aria-label={t("cut")} disabled={selectedCount === 0} onClick={() => void copyOrCut("move")}>
              <Scissors size={15} />
            </button>
            <button className="icon-button" type="button" title={t("paste")} aria-label={t("paste")} disabled={!clipboard || busy} onClick={() => void pasteTo()}>
              <ClipboardPaste size={15} />
            </button>
            <button className="icon-button cancel-button" type="button" title={t("cancelFileOperation")} aria-label={t("cancelFileOperation")} disabled={transferTaskId === null} onClick={() => transferTaskId !== null && void cancelFileOperation(transferTaskId)}>
              <Square size={13} fill="currentColor" />
            </button>
            <button className="icon-button" type="button" title={t("rename")} aria-label={t("rename")} disabled={selectedCount !== 1 || !entryCanMutate(selectedEntry)} onClick={() => beginRename()}>
              <FilePenLine size={15} />
            </button>
            <button className="icon-button recycle-button" type="button" title={t("recycleBin")} aria-label={t("recycleBin")} disabled={selectedCount === 0} onClick={() => void beginRecycle()}>
              <Trash2 size={15} />
            </button>
            <button className={previewOpen ? "icon-button is-active" : "icon-button"} type="button" title={t("previewShortcut")} aria-label={t("togglePreview")} aria-pressed={previewOpen} onClick={() => setPreviewOpen((current) => !current)}>
              <Eye size={15} />
            </button>
            <button className="icon-button" type="button" title={t("syncOtherPane")} aria-label={t("syncOtherPane")} disabled={!visibleSplit} onClick={syncOtherPane}>
              <ArrowLeftRight size={16} />
            </button>
            {presentation === "list" ? (
              <div className="column-picker" ref={columnMenuRef}>
                <button className={columnMenuOpen ? "icon-button is-active" : "icon-button"} type="button" title={t("chooseColumns")} aria-label={t("chooseColumns")} aria-expanded={columnMenuOpen} onClick={() => setColumnMenuOpen((current) => !current)}>
                  <Columns3 size={16} />
                </button>
                {columnMenuOpen ? (
                  <div className="column-picker-menu" role="menu" aria-label={t("listColumns")}>
                    {DIRECTORY_COLUMNS.map((column) => {
                      const visible = columns.includes(column);
                      return (
                        <button type="button" role="menuitemcheckbox" aria-checked={visible} disabled={column === "name"} key={column} onClick={() => {
                          toggleColumn(column);
                          setColumnMenuOpen(false);
                        }}>
                          <Check size={14} className={visible ? "" : "is-hidden"} />
                          <span>{t(DIRECTORY_COLUMN_LABELS[column])}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button className="icon-button" type="button" title={t("collapseFileActions")} aria-label={t("collapseFileActions")} onClick={() => onOperationsCollapsedChange?.(true)}>
              <PanelTopClose size={15} />
            </button>
          </div>
          <div className="browse-operation-status" role="status">
            {busy ? t("working") : error ?? notice ?? t("itemCount", { count: formatNumber(active.state.totalEntries) })}
          </div>
          {clipboard ? (
            <div className="clipboard-status" title={clipboard.entries.map((entry) => displayPath(entry.path)).join("\n")}>
              {clipboard.mode === "copy" ? <Clipboard size={14} /> : <Scissors size={14} />}
              <span>{clipboard.entries.length === 1 ? clipboard.entries[0]?.name : t("itemCount", { count: formatNumber(clipboard.entries.length) })}</span>
              <button className="icon-button" type="button" aria-label={t("clearClipboard")} onClick={() => setClipboard(null)}><X size={13} /></button>
            </div>
          ) : null}
        </div> : null}

        <div
          ref={browseContentRef}
          className={previewOpen
            ? `browse-content has-preview has-preview-resizer${previewPinned ? " is-preview-pinned" : ""}`
            : "browse-content"}
          style={previewOpen ? { "--preview-width": `${renderedPreviewWidth}px` } as React.CSSProperties : undefined}
        >
        <div
          ref={panesRef}
          className={visibleSplit ? "directory-panes has-resizer" : `directory-panes is-single is-${activePane}`}
          style={visibleSplit ? { gridTemplateColumns: `minmax(0, ${paneRatio}fr) 7px minmax(0, ${100 - paneRatio}fr)` } : undefined}
        >
          <section data-drop-directory={left.state.path} className={`${activePane === "left" ? "directory-pane is-active" : "directory-pane"}${presentation === "list" ? "" : " is-visual"}`}>
            <div className="directory-pane-heading">
              <strong>LEFT</strong>
              <div className="directory-pane-hierarchy" aria-label={`${t("left")} ${t("directoryContents")}`}>
                <button className="pane-hierarchy-button" type="button" title={t("up")} aria-label={`${t("left")}: ${t("parentFolder")}`} disabled={!left.state.parent} onClick={() => { setActivePane("left"); left.up(); }}><ArrowUp size={14} /></button>
                <button className="pane-hierarchy-button" type="button" title={t("openChildFolder")} aria-label={`${t("left")}: ${t("openChildFolder")}`} disabled={selectedLeftEntry?.kind !== "directory"} onClick={() => selectedLeftEntry && openEntry("left", selectedLeftEntry)}><ArrowDown size={14} /></button>
              </div>
              <span title={displayPath(left.state.path)}>{directoryPathLabel(left.state.path)}</span>
              <small>{formatNumber(left.visibleTotalEntries)}</small>
            </div>
            {presentation === "list" ? <DirectoryColumnHeadings columns={columns} sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /> : null}
            {presentation === "list" ? (
              <VirtualDirectoryList
                ref={leftListRef}
                totalEntries={left.visibleTotalEntries}
                status={left.visibleStatus}
                selectedPositions={leftSelection.positions}
                focusedPosition={leftSelection.focus}
                active={activePane === "left"}
                columns={columns}
                entryAt={left.entryAt}
                onNeedRange={left.ensureRange}
                onSelect={(position, modifiers) => handleSelect("left", position, modifiers)}
                onClearSelection={() => clearSelection("left")}
                onMarqueeStart={(modifiers) => startMarquee("left", modifiers)}
                onMarqueeChange={(positions) => changeMarquee("left", positions)}
                onOpen={(entry) => openEntry("left", entry)}
                onActivate={() => setActivePane("left")}
                onScrollVelocity={onScrollVelocity}
                onContextMenu={(event, entry, position) => handleContextMenu("left", event, entry, position)}
                onFileDragStart={(event, entry, position) => fileDragStart("left", event, entry, position)}
                onFileDragEnd={fileDragEnd}
                emptyLabel={left.search.query.trim() ? t("noMatchingItems") : undefined}
                hoverDelayMs={hoverDelayMs}
              />
            ) : (
              <VirtualDirectoryGrid
                ref={leftListRef}
                presentation={presentation}
                totalEntries={left.visibleTotalEntries}
                status={left.visibleStatus}
                selectedPositions={leftSelection.positions}
                focusedPosition={leftSelection.focus}
                active={activePane === "left"}
                entryAt={left.entryAt}
                onNeedRange={left.ensureRange}
                onSelect={(position, modifiers) => handleSelect("left", position, modifiers)}
                onClearSelection={() => clearSelection("left")}
                onMarqueeStart={(modifiers) => startMarquee("left", modifiers)}
                onMarqueeChange={(positions) => changeMarquee("left", positions)}
                onOpen={(entry) => openEntry("left", entry)}
                onActivate={() => setActivePane("left")}
                onScrollVelocity={onScrollVelocity}
                onContextMenu={(event, entry, position) => handleContextMenu("left", event, entry, position)}
                onFileDragStart={(event, entry, position) => fileDragStart("left", event, entry, position)}
                onFileDragEnd={fileDragEnd}
                emptyLabel={left.search.query.trim() ? t("noMatchingItems") : undefined}
                hoverDelayMs={hoverDelayMs}
                tileWidth={gridTileWidth}
                onTileWidthChange={changeGridTileWidth}
              />
            )}
            {left.visibleError ? <div className="pane-error">{left.visibleError}</div> : null}
          </section>
          {visibleSplit ? (
            <button
              className="pane-resizer"
              type="button"
              role="separator"
              aria-label={t("resizePanes")}
              aria-orientation="vertical"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(paneRatio)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                if ((event.buttons & 1) === 0) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  return;
                }
                updatePaneRatio(event.clientX);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  onPaneRatioChange?.(paneRatio + (event.key === "ArrowLeft" ? -2 : 2));
                }
              }}
            />
          ) : null}
          <section data-drop-directory={right.state.path} className={`${activePane === "right" ? "directory-pane is-active" : "directory-pane"}${presentation === "list" ? "" : " is-visual"}`}>
            <div className="directory-pane-heading">
              <strong>RIGHT</strong>
              <div className="directory-pane-hierarchy" aria-label={`${t("right")} ${t("directoryContents")}`}>
                <button className="pane-hierarchy-button" type="button" title={t("up")} aria-label={`${t("right")}: ${t("parentFolder")}`} disabled={!right.state.parent} onClick={() => { setActivePane("right"); right.up(); }}><ArrowUp size={14} /></button>
                <button className="pane-hierarchy-button" type="button" title={t("openChildFolder")} aria-label={`${t("right")}: ${t("openChildFolder")}`} disabled={selectedRightEntry?.kind !== "directory"} onClick={() => selectedRightEntry && openEntry("right", selectedRightEntry)}><ArrowDown size={14} /></button>
              </div>
              <span title={displayPath(right.state.path)}>{directoryPathLabel(right.state.path)}</span>
              <small>{formatNumber(right.visibleTotalEntries)}</small>
            </div>
            {presentation === "list" ? <DirectoryColumnHeadings columns={columns} sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /> : null}
            {presentation === "list" ? (
              <VirtualDirectoryList
                ref={rightListRef}
                totalEntries={right.visibleTotalEntries}
                status={right.visibleStatus}
                selectedPositions={rightSelection.positions}
                focusedPosition={rightSelection.focus}
                active={activePane === "right"}
                columns={columns}
                entryAt={right.entryAt}
                onNeedRange={right.ensureRange}
                onSelect={(position, modifiers) => handleSelect("right", position, modifiers)}
                onClearSelection={() => clearSelection("right")}
                onMarqueeStart={(modifiers) => startMarquee("right", modifiers)}
                onMarqueeChange={(positions) => changeMarquee("right", positions)}
                onOpen={(entry) => openEntry("right", entry)}
                onActivate={() => setActivePane("right")}
                onScrollVelocity={onScrollVelocity}
                onContextMenu={(event, entry, position) => handleContextMenu("right", event, entry, position)}
                onFileDragStart={(event, entry, position) => fileDragStart("right", event, entry, position)}
                onFileDragEnd={fileDragEnd}
                emptyLabel={right.search.query.trim() ? t("noMatchingItems") : undefined}
                hoverDelayMs={hoverDelayMs}
              />
            ) : (
              <VirtualDirectoryGrid
                ref={rightListRef}
                presentation={presentation}
                totalEntries={right.visibleTotalEntries}
                status={right.visibleStatus}
                selectedPositions={rightSelection.positions}
                focusedPosition={rightSelection.focus}
                active={activePane === "right"}
                entryAt={right.entryAt}
                onNeedRange={right.ensureRange}
                onSelect={(position, modifiers) => handleSelect("right", position, modifiers)}
                onClearSelection={() => clearSelection("right")}
                onMarqueeStart={(modifiers) => startMarquee("right", modifiers)}
                onMarqueeChange={(positions) => changeMarquee("right", positions)}
                onOpen={(entry) => openEntry("right", entry)}
                onActivate={() => setActivePane("right")}
                onScrollVelocity={onScrollVelocity}
                onContextMenu={(event, entry, position) => handleContextMenu("right", event, entry, position)}
                onFileDragStart={(event, entry, position) => fileDragStart("right", event, entry, position)}
                onFileDragEnd={fileDragEnd}
                emptyLabel={right.search.query.trim() ? t("noMatchingItems") : undefined}
                hoverDelayMs={hoverDelayMs}
                tileWidth={gridTileWidth}
                onTileWidthChange={changeGridTileWidth}
              />
            )}
            {right.visibleError ? <div className="pane-error">{right.visibleError}</div> : null}
          </section>
        </div>
        {previewOpen ? (
          <button
            ref={previewResizerRef}
            className="preview-resizer"
            type="button"
            role="separator"
            aria-label={t("resizePreview")}
            aria-orientation="vertical"
            aria-valuemin={240}
            aria-valuemax={520}
            aria-valuenow={renderedPreviewWidth}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              previewResizeRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: previewWidthRef.current,
                currentWidth: previewWidthRef.current,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onLostPointerCapture={() => finishPreviewResize(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const next = clampPreviewWidth(renderedPreviewWidth + (event.key === "ArrowLeft" ? 8 : -8));
                previewWidthRef.current = next;
                setRenderedPreviewWidth(next);
                onPreviewWidthChange?.(next);
              }
            }}
          />
        ) : null}
        {previewOpen ? (
          <PreviewPanel
            entry={selectedEntry}
            pinned={previewPinned}
            mediaAutoplay={mediaAutoplay}
            onMediaAutoplayChange={(enabled) => onMediaAutoplayChange?.(enabled)}
            onPinnedChange={(pinned) => {
              setPreviewPinned(pinned);
              try {
                window.localStorage.setItem("muller:preview-pinned", String(pinned));
              } catch {
                // Pinning remains available when persistence is unavailable.
              }
            }}
            onClose={() => setPreviewOpen(false)}
          />
        ) : null}
        </div>

        {routeVisible && contextMenu ? createPortal((
          <div ref={contextMenuRef} className="explorer-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            {!menuEntry ? <MenuButton icon={<FolderPlus size={14} />} onClick={() => void createNewEntry(contextMenu.pane, "directory")}>{t("newFolder")}</MenuButton> : null}
            {!menuEntry ? <MenuButton icon={<FilePlus2 size={14} />} onClick={() => void createNewEntry(contextMenu.pane, "text_file")}>{t("newTextDocument")}</MenuButton> : null}
            {!menuEntry ? <MenuButton icon={<FilePlus2 size={14} />} onClick={() => void createNewEntry(contextMenu.pane, "empty_file")}>{t("newEmptyFile")}</MenuButton> : null}
            {!menuEntry ? <span className="menu-separator" /> : null}
            {menuEntry ? <MenuButton icon={<ExternalLink size={14} />} onClick={() => openEntry(contextMenu.pane, menuEntry)}>{t("open")}</MenuButton> : null}
            {menuEntry?.kind === "file" ? <MenuButton icon={<AppWindow size={14} />} onClick={() => openEntryWith(menuEntry)}>{t("openWith")}</MenuButton> : null}
            {menuEntry?.kind === "directory" ? (
              <>
                <MenuButton icon={<FolderInput size={14} />} onClick={() => { void left.openPath(menuEntry.path); setActivePane("left"); setContextMenu(null); }}>{t("openLeftPane")}</MenuButton>
                <MenuButton icon={<FolderInput size={14} />} onClick={() => { void right.openPath(menuEntry.path); setActivePane("right"); setSplit(true); setContextMenu(null); }}>{t("openRightPane")}</MenuButton>
              </>
            ) : null}
            <MenuButton icon={<ArrowLeftRight size={14} />} disabled={!comparisonSelection || !onCompareSelection} onClick={() => {
              if (!comparisonSelection || !onCompareSelection) return;
              setContextMenu(null);
              onCompareSelection(comparisonSelection);
            }}>{t("comparePaneSelection")}</MenuButton>
            <span className="menu-separator" />
            <MenuButton icon={<Copy size={14} />} disabled={!entryCanMutate(menuEntry)} onClick={() => void copyOrCut("copy")}>{t("copy")}</MenuButton>
            <MenuButton icon={<Scissors size={14} />} disabled={!entryCanMutate(menuEntry)} onClick={() => void copyOrCut("move")}>{t("cut")}</MenuButton>
            <MenuButton icon={<ClipboardPaste size={14} />} disabled={!clipboard} onClick={() => void pasteTo(pasteDestination)}>{t("paste")}</MenuButton>
            {menuEntry ? <MenuButton icon={<ClipboardCopy size={14} />} onClick={() => void copyText(menuEntry.name, t("copiedName", { name: menuEntry.name }))}>{t("copyFileName")}</MenuButton> : null}
            {menuEntry ? <MenuButton icon={<ClipboardCopy size={14} />} onClick={() => void copyText(displayPath(menuEntry.path), t("copiedPath"))}>{t("copyFullPath")}</MenuButton> : null}
            <span className="menu-separator" />
            <MenuButton icon={<SquareTerminal size={14} />} onClick={() => showTerminal(menuEntry?.path ?? menuPane.state.path)}>{t("openTerminal")}</MenuButton>
            {menuEntry?.kind === "file" && menuEntry.extension?.toLowerCase() === "zip" ? <MenuButton icon={<FileArchive size={14} />} onClick={() => void extractArchive(contextMenu.pane, menuEntry, "current")}>{t("extractCurrent")}</MenuButton> : null}
            {menuEntry?.kind === "file" && menuEntry.extension?.toLowerCase() === "zip" ? <MenuButton icon={<FileArchive size={14} />} onClick={() => void extractArchive(contextMenu.pane, menuEntry, "named")}>{t("extractNamed")}</MenuButton> : null}
            {menuEntry?.kind === "file" && menuEntry.extension?.toLowerCase() === "zip" ? <MenuButton icon={<FolderInput size={14} />} onClick={() => void chooseArchiveDestination(contextMenu.pane, menuEntry)}>{t("extractChoose")}</MenuButton> : null}
            <MenuButton icon={<FileArchive size={14} />} disabled={selectedCount === 0} onClick={() => void compressSelection(contextMenu.pane)}>{t("compressZip")}</MenuButton>
            <span className="menu-separator" />
            {menuEntry ? <MenuButton icon={<FilePenLine size={14} />} disabled={!entryCanMutate(menuEntry)} onClick={() => beginRename(menuEntry)}>{t("rename")}</MenuButton> : null}
            {menuEntry ? <MenuButton icon={<Trash2 size={14} />} disabled={!entryCanMutate(menuEntry)} onClick={() => void beginRecycle()}>{t("recycleSelected")}</MenuButton> : null}
            {menuEntry ? <MenuButton icon={<Info size={14} />} onClick={() => { setPropertiesTarget(menuEntry); setContextMenu(null); }}>{t("properties")}</MenuButton> : null}
            {!menuEntry ? <MenuButton icon={<RefreshCw size={14} />} onClick={() => { menuPane.refresh(); setContextMenu(null); }}>{t("refresh")}</MenuButton> : null}
          </div>
        ), document.body) : null}

        {routeVisible && renameTarget ? (
          <DialogShell title={t("renameDialog")} icon={<FilePenLine size={17} />} onClose={() => setRenameTarget(null)}>
            <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void performRename(renameTarget.path, renameValue.trim(), "fail"); }}>
              <input autoFocus aria-label={t("newName")} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
              {error ? <div className="dialog-error" role="alert">{error}</div> : null}
              <div className="explorer-dialog-actions"><button className="command-button" type="button" onClick={() => setRenameTarget(null)}>{t("cancel")}</button><button className="command-button is-primary" type="submit" disabled={busy || !renameValue.trim()}>{t("rename")}</button></div>
            </form>
          </DialogShell>
        ) : null}

        {routeVisible && recycleTarget.length > 0 ? (
          <DialogShell title={t("recycleDialog")} icon={<Trash2 size={17} />} onClose={() => setRecycleTarget([])}>
            <p className="dialog-path">
              {recycleTarget.length === 1
                ? displayPath(recycleTarget[0]?.path ?? "")
                : t("selectedItems", { count: formatNumber(recycleTarget.length) })}
            </p>
            {recycleTarget.length > 1 ? (
              <div className="recycle-review-list">
                {recycleTarget.slice(0, 100).map((entry) => (
                  <div key={entry.path} title={displayPath(entry.path)}>{displayPath(entry.path)}</div>
                ))}
                {recycleTarget.length > 100 ? <small>{t("andMore", { count: formatNumber(recycleTarget.length - 100) })}</small> : null}
              </div>
            ) : null}
            {error ? <div className="dialog-error" role="alert">{error}</div> : null}
            <div className="explorer-dialog-actions"><button className="command-button" type="button" onClick={() => setRecycleTarget([])}>{t("cancel")}</button><button className="command-button is-danger" type="button" disabled={busy} onClick={() => void confirmRecycle()}><Trash2 size={14} /> {t("moveToRecycleBin", { count: formatNumber(recycleTarget.length) })}</button></div>
          </DialogShell>
        ) : null}

        {routeVisible && pendingConflict ? (
          <DialogShell title={t("destinationExists")} icon={<Copy size={17} />} onClose={() => setPendingConflict(null)}>
            <div className="conflict-actions">
              {(["skip", "keep_both", "replace"] as const).map((strategy) => (
                <button className={strategy === "replace" ? "command-button is-danger" : "command-button"} type="button" disabled={busy} key={strategy} onClick={() => {
                  if (pendingConflict.kind === "transfer") void performTransfer(pendingConflict.source, pendingConflict.destinationDirectory, pendingConflict.mode, strategy);
                  else void performRename(pendingConflict.source, pendingConflict.newName, strategy);
                }}>{t(strategy === "keep_both" ? "keepBoth" : strategy)}</button>
              ))}
            </div>
          </DialogShell>
        ) : null}

        {routeVisible && propertiesTarget ? <EntryPropertiesDialog entry={propertiesTarget} onClose={() => setPropertiesTarget(null)} /> : null}
      </section>
    );
  },
);
