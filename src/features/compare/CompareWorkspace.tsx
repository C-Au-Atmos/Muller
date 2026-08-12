import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Binary,
  ClipboardCopy,
  ClipboardPaste,
  Columns2,
  Copy,
  ExternalLink,
  FileDiff,
  FilePenLine,
  FolderGit2,
  Info,
  ListTree,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  Square,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";

import { formatBytes } from "../dedup/duplicateListModel";
import { useAppI18n } from "../../i18n/i18n";
import { DirectorySearchBar } from "../explorer/DirectorySearchBar";
import {
  BrowseWorkspace,
  type BrowseComparisonRequest,
  type BrowseNavigationState,
  type BrowseWorkspaceHandle,
} from "../explorer/BrowseWorkspace";
import { DialogShell, EntryPropertiesDialog, MenuButton } from "../explorer/ExplorerOverlays";
import {
  openNativePath,
  openTerminal,
  recycleEntry,
  renameEntry,
  transferEntry,
} from "../explorer/fileOperationsClient";
import {
  VirtualDirectoryList,
  type VirtualDirectoryListHandle,
} from "../explorer/VirtualDirectoryList";
import type { DirectoryEntry, FileClipboardState, TransferMode } from "../explorer/types";
import { displayPath, sameWindowsPath } from "../explorer/pathDisplay";
import { useDirectoryPane } from "../explorer/useDirectoryPane";
import { PreviewPanel } from "../preview/PreviewPanel";
import {
  VirtualFolderDiffList,
  type VirtualFolderDiffListHandle,
} from "./VirtualFolderDiffList";
import {
  VirtualTextDiff,
  type VirtualTextDiffHandle,
} from "./VirtualTextDiff";
import type { BinaryDiffRange, FolderDiffEntry } from "./types";
import { useFileDiff, BINARY_PAGE_SIZE } from "./useFileDiff";
import { useEditSession } from "./useEditSession";
import { useFolderDiff } from "./useFolderDiff";

type PaneId = "left" | "right";
type CompareView = "browse" | "folder" | "file";
const NATIVE_DRAG_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAANElEQVRYR+3OMQ0AAAjEMMC/5yFjRxMFfXpm5g5gACN2gAE7wIAdYMAOMGAHGLADfKwBfgGShwM9EKgB0QAAAABJRU5ErkJggg==";

const EditableMergeView = lazy(() => import("./EditableMergeView"));

export interface CompareNavigationState {
  activePane: PaneId;
  path: string;
  split: boolean;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  searchQuery: string;
  searchMode: BrowseNavigationState["searchMode"];
  searchResultCount: number;
  totalEntries: number;
  searchBoth: boolean;
  canSearchBoth: boolean;
  editing: boolean;
}

export interface CompareWorkspaceHandle {
  navigateActive: (path: string) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  moveSelection: (delta: number) => void;
  openSelection: () => void;
  nextDifference: () => void;
  previousDifference: () => void;
  toggleSplit: () => void;
  activatePane: (pane: PaneId) => void;
  findInDirectory: () => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: BrowseNavigationState["searchMode"]) => void;
  setSearchBoth: (enabled: boolean) => void;
  commitSearch: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;
  renameSelection: () => void;
  recycleSelection: () => void;
  refresh: () => void;
  togglePreview: () => void;
}

interface CompareWorkspaceProps {
  initialRoot: string;
  onNavigationChange: (state: CompareNavigationState) => void;
  onScrollVelocity: (velocity: number) => void;
  onSuccess: (message: string) => void;
  clipboard?: FileClipboardState | null;
  onClipboardChange?: (clipboard: FileClipboardState | null) => void;
  mediaAutoplay?: boolean;
  onMediaAutoplayChange?: (enabled: boolean) => void;
  paneRatio?: number;
  previewWidth?: number;
  globalSearchRoots?: readonly string[];
  hoverDelayMs?: number;
  onPaneRatioChange?: (ratio: number) => void;
  onPreviewWidthChange?: (width: number) => void;
  launchRequest?: {
    token: number;
    leftPath: string;
    rightPath: string;
    kind: "file" | "directory";
  } | null;
  onLaunchConsumed?: (token: number) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  pane: PaneId;
  entry: DirectoryEntry | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

function initialPreviewPinned(): boolean {
  try {
    return window.localStorage.getItem("muller:preview-pinned") === "true";
  } catch {
    return false;
  }
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return separator > 2 ? normalized.slice(0, separator) : normalized.slice(0, separator + 1);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

function HexSide({ bytes, different }: { bytes: readonly number[]; different: ReadonlySet<number> }) {
  return (
    <code className="hex-byte-line">
      {bytes.map((byte, index) => (
        <span className={different.has(index) ? "is-different" : undefined} key={index}>
          {byte.toString(16).padStart(2, "0")}
        </span>
      ))}
    </code>
  );
}

function BinaryDiffView({
  range,
  onPrevious,
  onNext,
}: {
  range: BinaryDiffRange | null;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useAppI18n();
  if (!range) return <div className="empty-result">{t("loadingBinaryRange")}</div>;
  const rows = Math.ceil(Math.max(range.left.length, range.right.length) / 16);
  const different = new Set(range.different_indices);
  return (
    <div className="binary-diff-view">
      <div className="binary-range-toolbar">
        <button className="icon-button" type="button" title={t("previousByteRange")} aria-label={t("previousByteRange")} onClick={onPrevious}>
          <ArrowLeft size={15} />
        </button>
        <code>0x{range.offset.toString(16).padStart(8, "0")}</code>
        <button className="icon-button" type="button" title={t("nextByteRange")} aria-label={t("nextByteRange")} onClick={onNext}>
          <ArrowRight size={15} />
        </button>
        <span>{formatBytes(range.left_size)} / {formatBytes(range.right_size)}</span>
      </div>
      <div className="hex-column-headings">
        <span>{t("offset")}</span><span>{t("left")}</span><span>{t("right")}</span>
      </div>
      <div className="hex-rows">
        {Array.from({ length: rows }, (_, row) => {
          const start = row * 16;
          const left = range.left.slice(start, start + 16);
          const right = range.right.slice(start, start + 16);
          const rowDifferences = new Set(
            Array.from(different)
              .filter((index) => index >= start && index < start + 16)
              .map((index) => index - start),
          );
          return (
            <div className="hex-row" key={start}>
              <code>{(range.offset + start).toString(16).padStart(8, "0")}</code>
              <HexSide bytes={left} different={rowDifferences} />
              <HexSide bytes={right} different={rowDifferences} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const CompareWorkspace = forwardRef<CompareWorkspaceHandle, CompareWorkspaceProps>(
  function CompareWorkspace(
    {
      initialRoot,
      onNavigationChange,
      onScrollVelocity,
      onSuccess,
      clipboard = null,
      onClipboardChange,
      mediaAutoplay = false,
      onMediaAutoplayChange,
      paneRatio = 50,
      previewWidth = 320,
      globalSearchRoots = [],
      hoverDelayMs = 40,
      onPaneRatioChange,
      onPreviewWidthChange,
      launchRequest,
      onLaunchConsumed,
    },
    ref,
  ) {
    const { t, formatNumber } = useAppI18n();
    const left = useDirectoryPane(initialRoot, undefined, [], false);
    const right = useDirectoryPane(initialRoot, undefined, [], false);
    const browserRef = useRef<BrowseWorkspaceHandle>(null);
    const folderDiff = useFolderDiff();
    const fileDiff = useFileDiff();
    const leftListRef = useRef<VirtualDirectoryListHandle>(null);
    const rightListRef = useRef<VirtualDirectoryListHandle>(null);
    const leftSearchRef = useRef<HTMLInputElement>(null);
    const rightSearchRef = useRef<HTMLInputElement>(null);
    const folderListRef = useRef<VirtualFolderDiffListHandle>(null);
    const textListRef = useRef<VirtualTextDiffHandle>(null);
    const [activePane, setActivePane] = useState<PaneId>("left");
    const [selectedLeft, setSelectedLeft] = useState(0);
    const [selectedRight, setSelectedRight] = useState(0);
    const [selectedFolderRow, setSelectedFolderRow] = useState(0);
    const [selectedTextRow, setSelectedTextRow] = useState(0);
    const [view, setView] = useState<CompareView>("browse");
    const [strictMtime, setStrictMtime] = useState(false);
    const [split, setSplit] = useState(true);
    const [searchOpen, setSearchOpen] = useState({ left: false, right: false });
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [operationError, setOperationError] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<DirectoryEntry | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [recycleTarget, setRecycleTarget] = useState<DirectoryEntry | null>(null);
    const [propertiesTarget, setPropertiesTarget] = useState<DirectoryEntry | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewPinned, setPreviewPinned] = useState(initialPreviewPinned);
    const [browserNavigation, setBrowserNavigation] = useState<BrowseNavigationState>({
      activePane: "left",
      path: initialRoot,
      leftPath: initialRoot,
      rightPath: initialRoot,
      split: true,
      canBack: false,
      canForward: false,
      canUp: false,
      selectedName: null,
      searchQuery: "",
      searchMode: "current",
      searchResultCount: 0,
      totalEntries: 0,
      searchBoth: false,
      canSearchBoth: true,
    });
    const [browserComparisonSelection, setBrowserComparisonSelection] = useState<BrowseComparisonRequest | null>(null);
    const previousFolderStatus = useRef(folderDiff.state.status);
    const consumedLaunchToken = useRef<number | null>(null);
    const {
      state: editState,
      open: openEdit,
      close: closeEdit,
      updateText: updateEditText,
      save: saveEdit,
      rollback: rollbackEdit,
    } = useEditSession();

    const active = activePane === "left" ? left : right;
    const activeSelected = activePane === "left" ? selectedLeft : selectedRight;
    const selectedEntry = active.entryAt(activeSelected) ?? null;
    const comparingSameFolder = sameWindowsPath(browserNavigation.leftPath, browserNavigation.rightPath);

    useEffect(() => {
      setActivePane(browserNavigation.activePane);
      setSplit(browserNavigation.split);
    }, [browserNavigation.activePane, browserNavigation.split]);

    const activatePaneWithFocus = useCallback(
      (pane: PaneId) => {
        if (!split || view !== "browse") return;
        setActivePane(pane);
        window.requestAnimationFrame(() =>
          (pane === "left" ? leftListRef : rightListRef).current?.focus(),
        );
      },
      [split, view],
    );

    const closeSearch = useCallback(
      (pane: PaneId) => {
        const target = pane === "left" ? left : right;
        target.setSearchQuery("");
        setSearchOpen((current) => ({ ...current, [pane]: false }));
        window.requestAnimationFrame(() =>
          (pane === "left" ? leftListRef : rightListRef).current?.focus(),
        );
      },
      [left, right],
    );

    useEffect(() => {
      const switchPaneWithTab = (event: KeyboardEvent) => {
        if (event.key !== "Tab" || event.ctrlKey || event.altKey || view !== "browse" || !split) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
        if (!(target instanceof HTMLElement) || !target.closest(".compare-browser-legacy")) return;
        event.preventDefault();
        activatePaneWithFocus(event.shiftKey
          ? (activePane === "left" ? "right" : "left")
          : (activePane === "left" ? "right" : "left"));
      };
      window.addEventListener("keydown", switchPaneWithTab);
      return () => window.removeEventListener("keydown", switchPaneWithTab);
    }, [activePane, activatePaneWithFocus, split, view]);

    useEffect(() => {
      onNavigationChange({
        activePane: browserNavigation.activePane,
        path: browserNavigation.path,
        split: browserNavigation.split,
        canBack: browserNavigation.canBack,
        canForward: browserNavigation.canForward,
        canUp: browserNavigation.canUp,
        searchQuery: browserNavigation.searchQuery,
        searchMode: browserNavigation.searchMode,
        searchResultCount: browserNavigation.searchResultCount,
        totalEntries: browserNavigation.totalEntries,
        searchBoth: browserNavigation.searchBoth,
        canSearchBoth: browserNavigation.canSearchBoth,
        editing: editState.phase === "ready",
      });
    }, [
      browserNavigation,
      editState.phase,
      onNavigationChange,
    ]);

    const openDirectoryEntry = useCallback(
      (pane: PaneId, entry: DirectoryEntry) => {
        setActivePane(pane);
        if (entry.kind === "directory") {
          void (pane === "left" ? left.openPath(entry.path) : right.openPath(entry.path));
          return;
        }
        void openNativePath(entry.path).then((outcome) => {
          if (outcome === "opened") onSuccess(t("openedEntry", { name: entry.name }));
        }).catch((error) => setOperationError(errorMessage(error, t("unableOpenEntry"))));
      },
      [left, onSuccess, right, t],
    );

    const startFolderComparison = useCallback(() => {
      if (comparingSameFolder) return;
      closeEdit();
      setView("folder");
      fileDiff.reset();
      setSelectedFolderRow(0);
      void folderDiff.start(browserNavigation.leftPath, browserNavigation.rightPath, strictMtime);
    }, [
      browserNavigation.leftPath,
      browserNavigation.rightPath,
      closeEdit,
      comparingSameFolder,
      fileDiff,
      folderDiff,
      strictMtime,
    ]);

    const selectedLeftEntry = left.entryAt(selectedLeft);
    const selectedRightEntry = right.entryAt(selectedRight);

    const refreshBoth = useCallback(() => {
      left.refresh();
      right.refresh();
    }, [left, right]);

    const copyOrCut = useCallback((mode: TransferMode, entry = selectedEntry) => {
      if (!entry || (entry.kind !== "file" && entry.kind !== "directory")) return;
      onClipboardChange?.({ mode, entries: [entry] });
      setContextMenu(null);
      setOperationError(null);
    }, [onClipboardChange, selectedEntry]);

    const pasteTo = useCallback(async (destinationDirectory = active.state.path) => {
      if (!clipboard || !destinationDirectory || busy) return;
      setBusy(true);
      setOperationError(null);
      let completed = 0;
      try {
        for (const entry of clipboard.entries) {
          await transferEntry(entry.path, destinationDirectory, clipboard.mode, "keep_both");
          completed += 1;
        }
        if (clipboard.mode === "move") onClipboardChange?.(null);
        refreshBoth();
        onSuccess(t("transferredItems", {
          operation: t(clipboard.mode === "copy" ? "copied" : "moved"),
          count: completed,
        }));
      } catch (error) {
        setOperationError(errorMessage(error, t("unableTransfer")));
      } finally {
        setBusy(false);
        setContextMenu(null);
      }
    }, [active.state.path, busy, clipboard, onClipboardChange, onSuccess, refreshBoth, t]);

    const beginRename = useCallback((entry = selectedEntry) => {
      if (!entry || (entry.kind !== "file" && entry.kind !== "directory")) return;
      setRenameTarget(entry);
      setRenameValue(entry.name);
      setOperationError(null);
      setContextMenu(null);
    }, [selectedEntry]);

    const performRename = useCallback(async () => {
      if (!renameTarget || !renameValue.trim() || busy) return;
      setBusy(true);
      setOperationError(null);
      try {
        await renameEntry(renameTarget.path, renameValue.trim(), "fail");
        setRenameTarget(null);
        refreshBoth();
        onSuccess(t("renamedEntry", { name: renameValue.trim() }));
      } catch (error) {
        setOperationError(errorMessage(error, t("unableRename")));
      } finally {
        setBusy(false);
      }
    }, [busy, onSuccess, refreshBoth, renameTarget, renameValue, t]);

    const confirmRecycle = useCallback(async () => {
      if (!recycleTarget || busy) return;
      setBusy(true);
      setOperationError(null);
      try {
        await recycleEntry(recycleTarget);
        setRecycleTarget(null);
        refreshBoth();
        onSuccess(t("recycledItems", { count: 1 }));
      } catch (error) {
        setOperationError(errorMessage(error, t("unableRecycleEntry")));
      } finally {
        setBusy(false);
      }
    }, [busy, onSuccess, recycleTarget, refreshBoth, t]);

    const copyText = useCallback(async (value: string, message: string) => {
      setContextMenu(null);
      try {
        await navigator.clipboard.writeText(value);
        setNotice(message);
      } catch (error) {
        setOperationError(errorMessage(error, t("unableClipboard")));
      }
    }, [t]);

    const handleContextMenu = useCallback((
      pane: PaneId,
      event: ReactMouseEvent<HTMLElement>,
      entry: DirectoryEntry | null,
      position: number | null,
    ) => {
      event.preventDefault();
      setActivePane(pane);
      if (position !== null) {
        if (pane === "left") setSelectedLeft(position);
        else setSelectedRight(position);
      }
      setContextMenu({ x: event.clientX, y: event.clientY, pane, entry });
    }, []);

    const fileDragStart = useCallback((event: ReactDragEvent<HTMLElement>, entry: DirectoryEntry) => {
      if (!isTauri() || (entry.kind !== "file" && entry.kind !== "directory")) return;
      event.preventDefault();
      void startDrag({
        item: [entry.path],
        icon: NATIVE_DRAG_ICON,
        mode: event.ctrlKey ? "copy" : "move",
      }).catch((error) => setOperationError(errorMessage(error, t("unableTransfer"))));
    }, [t]);

    const startSelectedFileComparison = useCallback(() => {
      if (!browserComparisonSelection || browserComparisonSelection.kind !== "file") return;
      closeEdit();
      setView("file");
      setSelectedTextRow(0);
      void fileDiff.start(browserComparisonSelection.leftPath, browserComparisonSelection.rightPath);
    }, [browserComparisonSelection, closeEdit, fileDiff]);

    const startBrowseComparison = useCallback((request: BrowseComparisonRequest) => {
      closeEdit();
      if (request.kind === "file") {
        setView("file");
        setSelectedTextRow(0);
        void fileDiff.start(request.leftPath, request.rightPath);
        return;
      }
      setView("folder");
      fileDiff.reset();
      setSelectedFolderRow(0);
      void folderDiff.start(request.leftPath, request.rightPath, strictMtime);
    }, [closeEdit, fileDiff, folderDiff, strictMtime]);

    useEffect(() => {
      if (!launchRequest || consumedLaunchToken.current === launchRequest.token) return;
      consumedLaunchToken.current = launchRequest.token;
      closeEdit();
      setSelectedFolderRow(0);
      setSelectedTextRow(0);
      if (launchRequest.kind === "file") {
        const leftDirectory = parentDirectory(launchRequest.leftPath);
        const rightDirectory = parentDirectory(launchRequest.rightPath);
        browserRef.current?.navigatePane("left", leftDirectory);
        browserRef.current?.navigatePane("right", rightDirectory);
        setView("file");
        void fileDiff.start(launchRequest.leftPath, launchRequest.rightPath);
      } else {
        browserRef.current?.navigatePane("left", launchRequest.leftPath);
        browserRef.current?.navigatePane("right", launchRequest.rightPath);
        setView("folder");
        fileDiff.reset();
        void folderDiff.start(launchRequest.leftPath, launchRequest.rightPath, strictMtime);
      }
      onLaunchConsumed?.(launchRequest.token);
    }, [closeEdit, fileDiff, folderDiff, launchRequest, left, onLaunchConsumed, right, strictMtime]);

    const openFolderDiffEntry = useCallback(
      (entry: FolderDiffEntry) => {
        if (entry.kind !== "file" || !entry.left || !entry.right) return;
        closeEdit();
        setView("file");
        setSelectedTextRow(0);
        void fileDiff.start(entry.left.path, entry.right.path);
      },
      [closeEdit, fileDiff],
    );

    const startEditing = useCallback(() => {
      const inspection = fileDiff.state.inspection;
      if (inspection?.kind !== "text") return;
      void openEdit(inspection.left_path, inspection.right_path);
    }, [fileDiff.state.inspection, openEdit]);

    const closeEditing = useCallback(() => {
      const inspection = fileDiff.state.inspection;
      closeEdit();
      if (inspection?.kind === "text") {
        setSelectedTextRow(0);
        void fileDiff.start(inspection.left_path, inspection.right_path);
      }
    }, [closeEdit, fileDiff]);

    const moveSelection = useCallback(
      (delta: number) => {
        if (view === "folder") {
          setSelectedFolderRow((current) =>
            Math.min(Math.max(current + delta, 0), Math.max(folderDiff.state.totalEntries - 1, 0)),
          );
        } else if (view === "file" && fileDiff.state.inspection?.kind === "text") {
          setSelectedTextRow((current) =>
            Math.min(Math.max(current + delta, 0), Math.max(fileDiff.state.totalRows - 1, 0)),
          );
        } else if (activePane === "left") {
          const next = Math.min(Math.max(selectedLeft + delta, 0), Math.max(left.visibleTotalEntries - 1, 0));
          setSelectedLeft(next);
          leftListRef.current?.scrollToPosition(next);
        } else {
          const next = Math.min(Math.max(selectedRight + delta, 0), Math.max(right.visibleTotalEntries - 1, 0));
          setSelectedRight(next);
          rightListRef.current?.scrollToPosition(next);
        }
      },
      [
        activePane,
        fileDiff.state.inspection?.kind,
        fileDiff.state.totalRows,
        folderDiff.state.totalEntries,
        left.visibleTotalEntries,
        right.visibleTotalEntries,
        selectedLeft,
        selectedRight,
        view,
      ],
    );

    const openSelection = useCallback(() => {
      if (view === "folder") {
        const entry = folderDiff.entryAt(selectedFolderRow);
        if (entry) openFolderDiffEntry(entry);
      } else if (view === "browse") {
        const entry = active.entryAt(activeSelected);
        if (entry) openDirectoryEntry(activePane, entry);
      }
    }, [
      active,
      activePane,
      activeSelected,
      folderDiff,
      openDirectoryEntry,
      openFolderDiffEntry,
      selectedFolderRow,
      view,
    ]);

    const jumpDifference = useCallback(
      async (direction: 1 | -1) => {
        if (view === "folder") {
          const position = await folderDiff.findDifference(selectedFolderRow, direction);
          if (position !== null) {
            folderDiff.ensureRange(position, position + 1);
            setSelectedFolderRow(position);
          }
        } else if (view === "file" && fileDiff.state.inspection?.kind === "text") {
          const position = await fileDiff.findDifference(selectedTextRow, direction);
          if (position !== null) {
            fileDiff.ensureTextRange(position, position + 1);
            setSelectedTextRow(position);
          }
        }
      },
      [fileDiff, folderDiff, selectedFolderRow, selectedTextRow, view],
    );

    useEffect(() => {
      if (view === "folder") folderListRef.current?.scrollToPosition(selectedFolderRow);
    }, [selectedFolderRow, view]);
    useEffect(() => {
      if (view === "file") textListRef.current?.scrollToPosition(selectedTextRow);
    }, [selectedTextRow, view]);
    useEffect(() => setSelectedLeft(0), [left.search.query, left.state.path]);
    useEffect(() => setSelectedRight(0), [right.search.query, right.state.path]);

    useEffect(() => {
      if (
        previousFolderStatus.current === "loading" &&
        folderDiff.state.status === "ready"
      ) {
        onSuccess(t("folderComparisonComplete"));
      }
      previousFolderStatus.current = folderDiff.state.status;
    }, [folderDiff.state.status, onSuccess, t]);

    useImperativeHandle(ref, () => ({
      navigateActive(path) {
        closeEdit();
        setView("browse");
        browserRef.current?.navigateActive(path);
      },
      back() {
        closeEdit();
        setView("browse");
        browserRef.current?.back();
      },
      forward() {
        closeEdit();
        setView("browse");
        browserRef.current?.forward();
      },
      up() {
        closeEdit();
        setView("browse");
        browserRef.current?.up();
      },
      moveSelection(delta) {
        if (view === "browse") {
          browserRef.current?.moveSelection(delta < 0 ? "up" : "down");
          return;
        }
        moveSelection(delta);
      },
      openSelection() {
        if (view === "browse") browserRef.current?.openSelection();
        else openSelection();
      },
      nextDifference() {
        void jumpDifference(1);
      },
      previousDifference() {
        void jumpDifference(-1);
      },
      toggleSplit() {
        setView("browse");
        browserRef.current?.toggleSplit();
      },
      activatePane(pane) {
        browserRef.current?.activatePane(pane);
      },
      findInDirectory() {
        setView("browse");
        window.requestAnimationFrame(() => browserRef.current?.findInDirectory());
      },
      setSearchQuery(query) {
        browserRef.current?.setSearchQuery(query);
      },
      setSearchMode(mode) {
        browserRef.current?.setSearchMode(mode);
      },
      setSearchBoth(enabled) {
        browserRef.current?.setSearchBoth(enabled);
      },
      commitSearch() {
        browserRef.current?.commitSearch();
      },
      copySelection() {
        if (view === "browse") browserRef.current?.copySelection();
        else copyOrCut("copy");
      },
      cutSelection() {
        if (view === "browse") browserRef.current?.cutSelection();
        else copyOrCut("move");
      },
      paste() {
        if (view === "browse") browserRef.current?.paste();
        else void pasteTo();
      },
      renameSelection() {
        if (view === "browse") browserRef.current?.renameSelection();
        else beginRename();
      },
      recycleSelection() {
        if (view === "browse") browserRef.current?.recycleSelection();
        else if (selectedEntry?.kind === "file" || selectedEntry?.kind === "directory") {
          setRecycleTarget(selectedEntry);
        }
      },
      refresh() {
        if (view === "browse") browserRef.current?.refresh();
        else active.refresh();
      },
      togglePreview() {
        if (view === "browse") browserRef.current?.togglePreview();
      },
    }));

    const folderBusy = folderDiff.state.status === "loading";
    const binaryOffset = fileDiff.state.binary?.offset ?? 0;
    const contextPane = contextMenu?.pane === "right" ? right : left;
    const contextEntry = contextMenu?.entry ?? null;
    const renderLegacyBrowser: boolean = false;

    return (
      <section className="compare-workspace" aria-label={t("compareWorkspace")}>
        <div className="compare-toolbar">
          <div className="compare-view-tabs" role="tablist" aria-label={t("compareViews")}>
            <button
              className={view === "browse" ? "is-active" : undefined}
              type="button"
              role="tab"
              aria-selected={view === "browse"}
              onClick={() => setView("browse")}
            >
              <Columns2 size={15} /> {t("browse")}
            </button>
            <button
              className={view === "folder" ? "is-active" : undefined}
              type="button"
              role="tab"
              aria-selected={view === "folder"}
              onClick={() => setView("folder")}
            >
              <ListTree size={15} /> {t("folderDiff")}
            </button>
            {fileDiff.state.status !== "idle" ? (
              <button
                className={view === "file" ? "is-active" : undefined}
                type="button"
                role="tab"
                aria-selected={view === "file"}
                onClick={() => setView("file")}
              >
                {fileDiff.state.inspection?.kind === "binary" ? <Binary size={15} /> : <FileDiff size={15} />}
                {t("fileDiff")}
              </button>
            ) : null}
          </div>

          <div className="compare-actions">
            <label className="mtime-toggle">
              <input
                type="checkbox"
                checked={strictMtime}
                onChange={(event) => setStrictMtime(event.target.checked)}
              />
              <span>{t("strictTime")}</span>
            </label>
            <button
              className="command-button"
              type="button"
              disabled={browserComparisonSelection?.kind !== "file"}
              onClick={startSelectedFileComparison}
            >
              <FileDiff size={15} /> {t("files")}
            </button>
            <button
              className="command-button is-primary"
              type="button"
              disabled={
                !browserNavigation.split ||
                !browserNavigation.leftPath ||
                !browserNavigation.rightPath ||
                comparingSameFolder
              }
              onClick={startFolderComparison}
              title={
                comparingSameFolder
                  ? t("sameFoldersHint")
                  : t("compareFolders")
              }
            >
              <Play size={14} fill="currentColor" /> {t("compare")}
            </button>
            <button
              className="icon-button cancel-button"
              type="button"
              title={t("cancelFolderComparison")}
              aria-label={t("cancelFolderComparison")}
              disabled={!folderBusy}
              onClick={folderDiff.cancel}
            >
              <Square size={13} fill="currentColor" />
            </button>
          </div>
        </div>

        <div className={`compare-browser-surface compare-browser-shared${view === "browse" ? "" : " is-hidden"}`}>
          {comparingSameFolder ? <div className="compare-root-notice" role="status">{t("sameFoldersHint")}</div> : null}
          <BrowseWorkspace
            ref={browserRef}
            initialRoot={initialRoot}
            routeVisible={view === "browse"}
            presentation="list"
            paneRatio={paneRatio}
            previewWidth={previewWidth}
            globalSearchRoots={globalSearchRoots}
            onPaneRatioChange={onPaneRatioChange}
            onPreviewWidthChange={onPreviewWidthChange}
            onNavigationChange={setBrowserNavigation}
            onScrollVelocity={onScrollVelocity}
            onSuccess={onSuccess}
            hoverDelayMs={hoverDelayMs}
            onCompareSelection={startBrowseComparison}
            onComparisonSelectionChange={setBrowserComparisonSelection}
            mediaAutoplay={mediaAutoplay}
            onMediaAutoplayChange={onMediaAutoplayChange}
            clipboard={clipboard}
            onClipboardChange={onClipboardChange}
          />
        </div>

        {renderLegacyBrowser ? (
          <div className="compare-browser-surface compare-browser-legacy" aria-hidden="true">
            {comparingSameFolder || notice || operationError ? (
              <div className="compare-browser-notices">
                {comparingSameFolder ? <div className="compare-root-notice" role="status">{t("sameFoldersHint")}</div> : null}
                {notice ? <div className="compare-operation-status" role="status">{notice}</div> : null}
                {operationError ? <div className="compare-operation-status is-error" role="alert">{operationError}</div> : null}
              </div>
            ) : null}
          <div className={previewOpen ? `browse-content has-preview${previewPinned ? " is-preview-pinned" : ""}` : "browse-content"} style={{ "--preview-width": "320px" } as CSSProperties}>
          <div className={split ? "directory-panes" : `directory-panes is-single is-${activePane}`}>
            <section className={`${activePane === "left" ? "directory-pane is-active" : "directory-pane"}${searchOpen.left ? " has-search" : ""}`}>
              <div className="directory-pane-heading">
                <strong>LEFT</strong>
                <div className="directory-pane-hierarchy" aria-label={`${t("left")} ${t("directoryContents")}`}>
                  <button className="pane-hierarchy-button" type="button" title={t("up")} aria-label={`${t("left")}: ${t("parentFolder")}`} disabled={!left.state.parent} onClick={() => { setActivePane("left"); left.up(); }}><ArrowUp size={14} /></button>
                  <button className="pane-hierarchy-button" type="button" title={t("openChildFolder")} aria-label={`${t("left")}: ${t("openChildFolder")}`} disabled={selectedLeftEntry?.kind !== "directory"} onClick={() => selectedLeftEntry && openDirectoryEntry("left", selectedLeftEntry)}><ArrowDown size={14} /></button>
                </div>
                <span title={left.state.path}>{left.state.path}</span>
                <small>{formatNumber(left.visibleTotalEntries)}</small>
              </div>
              {searchOpen.left ? <DirectorySearchBar ref={leftSearchRef} label={t("searchLeftDirectory")} query={left.search.query} status={left.search.status} resultCount={left.visibleTotalEntries} totalCount={left.state.totalEntries} onQueryChange={left.setSearchQuery} onCommit={() => { setSelectedLeft(0); leftListRef.current?.focus(); }} onClose={() => closeSearch("left")} /> : null}
              <div className="directory-column-headings"><span>{t("name")}</span><span>{t("size")}</span><span>{t("modified")}</span></div>
              <VirtualDirectoryList
                ref={leftListRef}
                totalEntries={left.visibleTotalEntries}
                status={left.visibleStatus}
                selectedPositions={new Set([selectedLeft])}
                focusedPosition={selectedLeft}
                active={activePane === "left"}
                entryAt={left.entryAt}
                onNeedRange={left.ensureRange}
                onSelect={setSelectedLeft}
                onClearSelection={() => undefined}
                onMarqueeStart={() => undefined}
                onMarqueeChange={(positions) => {
                  const position = [...positions].at(-1);
                  if (position !== undefined) setSelectedLeft(position);
                }}
                onOpen={(entry) => openDirectoryEntry("left", entry)}
                onActivate={() => setActivePane("left")}
                onScrollVelocity={onScrollVelocity}
                onContextMenu={(event, entry, position) => handleContextMenu("left", event, entry, position)}
                onFileDragStart={(event, entry) => fileDragStart(event, entry)}
                emptyLabel={left.search.query.trim() ? t("noMatchingItems") : undefined}
              />
              {left.visibleError ? <div className="pane-error">{left.visibleError}</div> : null}
            </section>
            <section className={`${activePane === "right" ? "directory-pane is-active" : "directory-pane"}${searchOpen.right ? " has-search" : ""}`}>
              <div className="directory-pane-heading">
                <strong>RIGHT</strong>
                <div className="directory-pane-hierarchy" aria-label={`${t("right")} ${t("directoryContents")}`}>
                  <button className="pane-hierarchy-button" type="button" title={t("up")} aria-label={`${t("right")}: ${t("parentFolder")}`} disabled={!right.state.parent} onClick={() => { setActivePane("right"); right.up(); }}><ArrowUp size={14} /></button>
                  <button className="pane-hierarchy-button" type="button" title={t("openChildFolder")} aria-label={`${t("right")}: ${t("openChildFolder")}`} disabled={selectedRightEntry?.kind !== "directory"} onClick={() => selectedRightEntry && openDirectoryEntry("right", selectedRightEntry)}><ArrowDown size={14} /></button>
                </div>
                <span title={right.state.path}>{right.state.path}</span>
                <small>{formatNumber(right.visibleTotalEntries)}</small>
              </div>
              {searchOpen.right ? <DirectorySearchBar ref={rightSearchRef} label={t("searchRightDirectory")} query={right.search.query} status={right.search.status} resultCount={right.visibleTotalEntries} totalCount={right.state.totalEntries} onQueryChange={right.setSearchQuery} onCommit={() => { setSelectedRight(0); rightListRef.current?.focus(); }} onClose={() => closeSearch("right")} /> : null}
              <div className="directory-column-headings"><span>{t("name")}</span><span>{t("size")}</span><span>{t("modified")}</span></div>
              <VirtualDirectoryList
                ref={rightListRef}
                totalEntries={right.visibleTotalEntries}
                status={right.visibleStatus}
                selectedPositions={new Set([selectedRight])}
                focusedPosition={selectedRight}
                active={activePane === "right"}
                entryAt={right.entryAt}
                onNeedRange={right.ensureRange}
                onSelect={setSelectedRight}
                onClearSelection={() => undefined}
                onMarqueeStart={() => undefined}
                onMarqueeChange={(positions) => {
                  const position = [...positions].at(-1);
                  if (position !== undefined) setSelectedRight(position);
                }}
                onOpen={(entry) => openDirectoryEntry("right", entry)}
                onActivate={() => setActivePane("right")}
                onScrollVelocity={onScrollVelocity}
                onContextMenu={(event, entry, position) => handleContextMenu("right", event, entry, position)}
                onFileDragStart={(event, entry) => fileDragStart(event, entry)}
                emptyLabel={right.search.query.trim() ? t("noMatchingItems") : undefined}
              />
              {right.visibleError ? <div className="pane-error">{right.visibleError}</div> : null}
            </section>
          </div>
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
                  // Pinning still works for the current session.
                }
              }}
              onClose={() => setPreviewOpen(false)}
            />
          ) : null}
          </div>
          </div>
        ) : view === "folder" ? (
          <div className="folder-diff-pane">
            <div className="folder-diff-summary">
              <FolderGit2 size={15} />
              <span>{folderDiff.state.status === "loading" ? t("statusComparing") : folderDiff.state.status === "ready" ? t("statusReady") : folderDiff.state.status === "error" ? t("statusFailed") : folderDiff.state.status === "cancelled" ? t("statusCancelled") : t("statusReady")}</span>
              <span>{t("entryCount", { count: formatNumber(folderDiff.state.totalEntries) })}</span>
              <span>{t("changedCount", { count: formatNumber(folderDiff.state.stats?.different ?? 0) })}</span>
              <span
                title={t("verificationReadHint")}
              >
                {t("readForVerification", { size: formatBytes(
                  folderDiff.state.progress?.bytes_hashed ??
                    folderDiff.state.stats?.bytes_hashed ??
                    0,
                ) })}
              </span>
              {folderDiff.state.stats ? (
                <span>{t("filesVerified", { count: formatNumber(folderDiff.state.stats.hashed_files) })}</span>
              ) : null}
              {folderDiff.state.error ? <strong>{folderDiff.state.error}</strong> : null}
            </div>
            <div className="folder-diff-headings"><span>{t("left")}</span><span>{t("status")}</span><span>{t("right")}</span></div>
            <VirtualFolderDiffList
              ref={folderListRef}
              totalEntries={folderDiff.state.totalEntries}
              status={folderDiff.state.status}
              error={folderDiff.state.error}
              selectedPosition={selectedFolderRow}
              entryAt={folderDiff.entryAt}
              onNeedRange={folderDiff.ensureRange}
              onSelect={setSelectedFolderRow}
              onOpen={openFolderDiffEntry}
              onScrollVelocity={onScrollVelocity}
            />
          </div>
        ) : view === "file" ? (
          <div className={editState.phase === "ready" ? "file-diff-pane is-editing" : "file-diff-pane"}>
            <div className="file-diff-summary">
              <button
                className="icon-button"
                type="button"
                title={t("returnFolderComparison")}
                aria-label={t("returnFolderComparison")}
                onClick={() => {
                  closeEdit();
                  setView("folder");
                }}
              >
                <RotateCcw size={15} />
              </button>
              <strong>{fileDiff.state.inspection ? t(fileDiff.state.inspection.kind === "binary" ? "binary" : "text") : t("loading")}</strong>
              <span>{fileName(fileDiff.state.inspection?.left_path ?? "")}</span>
              <span>{fileName(fileDiff.state.inspection?.right_path ?? "")}</span>
              {fileDiff.state.inspection?.kind === "text" ? (
                <small>
                  {fileDiff.state.inspection.left_encoding}/{fileDiff.state.inspection.left_line_ending}
                  {" ↔ "}
                  {fileDiff.state.inspection.right_encoding}/{fileDiff.state.inspection.right_line_ending}
                </small>
              ) : null}
              {fileDiff.state.inspection?.kind === "text" && editState.phase !== "ready" ? (
                <button
                  className="command-button"
                  type="button"
                  disabled={editState.phase === "loading"}
                  onClick={startEditing}
                >
                  <Pencil size={14} /> {editState.phase === "loading" ? t("opening") : t("editMerge")}
                </button>
              ) : null}
              {fileDiff.state.error || editState.error ? (
                <b>{fileDiff.state.error ?? editState.error}</b>
              ) : null}
            </div>
            {fileDiff.state.inspection?.kind === "binary" ? (
              <BinaryDiffView
                range={fileDiff.state.binary}
                onPrevious={() => fileDiff.readBinaryOffset(binaryOffset - BINARY_PAGE_SIZE)}
                onNext={() => fileDiff.readBinaryOffset(binaryOffset + BINARY_PAGE_SIZE)}
              />
            ) : editState.phase === "ready" && editState.left && editState.right ? (
              <Suspense fallback={<div className="empty-result">{t("loadingEditor")}</div>}>
                <EditableMergeView
                  left={editState.left}
                  right={editState.right}
                  busySide={editState.busySide}
                  error={editState.error}
                  conflict={editState.conflict}
                  onChange={updateEditText}
                  onSave={(side) => void saveEdit(side)}
                  onRollback={(side) => void rollbackEdit(side)}
                  onClose={closeEditing}
                />
              </Suspense>
            ) : editState.phase === "loading" ? (
              <div className="empty-result">{t("openingProtectedEdit")}</div>
            ) : (
              <>
                <div className="text-diff-headings"><span>{t("left")}</span><span>{t("right")}</span></div>
                <VirtualTextDiff
                  ref={textListRef}
                  totalRows={fileDiff.state.totalRows}
                  selectedPosition={selectedTextRow}
                  rowAt={fileDiff.rowAt}
                  onNeedRange={fileDiff.ensureTextRange}
                  onSelect={setSelectedTextRow}
                  onScrollVelocity={onScrollVelocity}
                />
              </>
            )}
          </div>
        ) : null}

        {contextMenu ? createPortal((
          <div className="explorer-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            {contextEntry ? <MenuButton icon={<ExternalLink size={14} />} onClick={() => { openDirectoryEntry(contextMenu.pane, contextEntry); setContextMenu(null); }}>{t("open")}</MenuButton> : null}
            {contextEntry?.kind === "file" ? <MenuButton icon={<ExternalLink size={14} />} onClick={() => {
              setContextMenu(null);
              void openNativePath(contextEntry.path, true).catch((error) => setOperationError(errorMessage(error, t("unableOpenWith"))));
            }}>{t("openWith")}</MenuButton> : null}
            {contextEntry?.kind === "directory" ? (
              <>
                <MenuButton icon={<ArrowLeft size={14} />} onClick={() => { void left.openPath(contextEntry.path); setActivePane("left"); setContextMenu(null); }}>{t("openLeftPane")}</MenuButton>
                <MenuButton icon={<ArrowRight size={14} />} onClick={() => { void right.openPath(contextEntry.path); setActivePane("right"); setSplit(true); setContextMenu(null); }}>{t("openRightPane")}</MenuButton>
              </>
            ) : null}
            <span className="menu-separator" />
            <MenuButton icon={<Copy size={14} />} disabled={!contextEntry} onClick={() => copyOrCut("copy", contextEntry)}>{t("copy")}</MenuButton>
            <MenuButton icon={<Scissors size={14} />} disabled={!contextEntry} onClick={() => copyOrCut("move", contextEntry)}>{t("cut")}</MenuButton>
            <MenuButton icon={<ClipboardPaste size={14} />} disabled={!clipboard} onClick={() => void pasteTo(contextEntry?.kind === "directory" ? contextEntry.path : contextPane.state.path)}>{t("paste")}</MenuButton>
            {contextEntry ? <MenuButton icon={<ClipboardCopy size={14} />} onClick={() => void copyText(contextEntry.name, t("copiedName", { name: contextEntry.name }))}>{t("copyFileName")}</MenuButton> : null}
            {contextEntry ? <MenuButton icon={<ClipboardCopy size={14} />} onClick={() => void copyText(displayPath(contextEntry.path), t("copiedPath"))}>{t("copyFullPath")}</MenuButton> : null}
            <span className="menu-separator" />
            <MenuButton icon={<SquareTerminal size={14} />} onClick={() => {
              setContextMenu(null);
              void openTerminal(contextEntry?.path ?? contextPane.state.path).catch((error) => setOperationError(errorMessage(error, t("unableOpenTerminal"))));
            }}>{t("openTerminal")}</MenuButton>
            {contextEntry ? <MenuButton icon={<FilePenLine size={14} />} onClick={() => beginRename(contextEntry)}>{t("rename")}</MenuButton> : null}
            {contextEntry ? <MenuButton icon={<Trash2 size={14} />} onClick={() => { setRecycleTarget(contextEntry); setContextMenu(null); }}>{t("recycleSelected")}</MenuButton> : null}
            {contextEntry ? <MenuButton icon={<Info size={14} />} onClick={() => { setPropertiesTarget(contextEntry); setContextMenu(null); }}>{t("properties")}</MenuButton> : null}
            {!contextEntry ? <MenuButton icon={<RefreshCw size={14} />} onClick={() => { contextPane.refresh(); setContextMenu(null); }}>{t("refresh")}</MenuButton> : null}
          </div>
        ), document.body) : null}

        {renameTarget ? (
          <DialogShell title={t("renameDialog")} icon={<FilePenLine size={17} />} onClose={() => setRenameTarget(null)}>
            <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void performRename(); }}>
              <input autoFocus aria-label={t("newName")} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
              {operationError ? <div className="dialog-error" role="alert">{operationError}</div> : null}
              <div className="explorer-dialog-actions">
                <button className="command-button" type="button" onClick={() => setRenameTarget(null)}>{t("cancel")}</button>
                <button className="command-button is-primary" type="submit" disabled={busy || !renameValue.trim()}>{t("rename")}</button>
              </div>
            </form>
          </DialogShell>
        ) : null}

        {recycleTarget ? (
          <DialogShell title={t("recycleDialog")} icon={<Trash2 size={17} />} onClose={() => setRecycleTarget(null)}>
            <p className="dialog-path">{displayPath(recycleTarget.path)}</p>
            {operationError ? <div className="dialog-error" role="alert">{operationError}</div> : null}
            <div className="explorer-dialog-actions">
              <button className="command-button" type="button" onClick={() => setRecycleTarget(null)}>{t("cancel")}</button>
              <button className="command-button is-danger" type="button" disabled={busy} onClick={() => void confirmRecycle()}><Trash2 size={14} /> {t("moveToRecycleBin", { count: 1 })}</button>
            </div>
          </DialogShell>
        ) : null}

        {propertiesTarget ? <EntryPropertiesDialog entry={propertiesTarget} onClose={() => setPropertiesTarget(null)} /> : null}
      </section>
    );
  },
);
