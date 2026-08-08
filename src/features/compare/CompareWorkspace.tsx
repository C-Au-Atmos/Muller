import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Binary,
  Columns2,
  FileDiff,
  FolderGit2,
  ListTree,
  Pencil,
  Play,
  RotateCcw,
  Search,
  Square,
} from "lucide-react";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { formatBytes } from "../dedup/duplicateListModel";
import { useAppI18n } from "../../i18n/i18n";
import { DirectorySearchBar } from "../explorer/DirectorySearchBar";
import {
  VirtualDirectoryList,
  type VirtualDirectoryListHandle,
} from "../explorer/VirtualDirectoryList";
import type { DirectoryEntry } from "../explorer/types";
import { sameWindowsPath } from "../explorer/pathDisplay";
import { useDirectoryPane } from "../explorer/useDirectoryPane";
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

const EditableMergeView = lazy(() => import("./EditableMergeView"));

export interface CompareNavigationState {
  activePane: PaneId;
  path: string;
  split: boolean;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
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
}

interface CompareWorkspaceProps {
  initialRoot: string;
  onNavigationChange: (state: CompareNavigationState) => void;
  onScrollVelocity: (velocity: number) => void;
  onSuccess: (message: string) => void;
  launchRequest?: {
    token: number;
    leftPath: string;
    rightPath: string;
    kind: "file" | "directory";
  } | null;
  onLaunchConsumed?: (token: number) => void;
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
    { initialRoot, onNavigationChange, onScrollVelocity, onSuccess, launchRequest, onLaunchConsumed },
    ref,
  ) {
    const { t, formatNumber } = useAppI18n();
    const left = useDirectoryPane(initialRoot);
    const right = useDirectoryPane(initialRoot);
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
    const comparingSameFolder = sameWindowsPath(left.state.path, right.state.path);

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

    const openSearch = useCallback(
      (pane: PaneId) => {
        if (view !== "browse") return;
        setSearchOpen((current) => ({ ...current, [pane]: true }));
        window.requestAnimationFrame(() => {
          const input = (pane === "left" ? leftSearchRef : rightSearchRef).current;
          input?.focus();
          input?.select();
        });
      },
      [view],
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
      onNavigationChange({
        activePane,
        path: active.state.requestedPath || active.state.path,
        split,
        canBack: active.canBack,
        canForward: active.canForward,
        canUp: active.state.parent !== null,
        editing: editState.phase === "ready",
      });
    }, [
      active.canBack,
      active.canForward,
      active.state.parent,
      active.state.path,
      active.state.requestedPath,
      activePane,
      editState.phase,
      onNavigationChange,
      split,
    ]);

    const openDirectoryEntry = useCallback(
      (pane: PaneId, entry: DirectoryEntry) => {
        setActivePane(pane);
        if (entry.kind === "directory") {
          void (pane === "left" ? left.openPath(entry.path) : right.openPath(entry.path));
        }
      },
      [left, right],
    );

    const startFolderComparison = useCallback(() => {
      if (comparingSameFolder) return;
      closeEdit();
      setView("folder");
      fileDiff.reset();
      setSelectedFolderRow(0);
      void folderDiff.start(left.state.path, right.state.path, strictMtime);
    }, [
      closeEdit,
      comparingSameFolder,
      fileDiff,
      folderDiff,
      left.state.path,
      right.state.path,
      strictMtime,
    ]);

    const selectedLeftEntry = left.entryAt(selectedLeft);
    const selectedRightEntry = right.entryAt(selectedRight);

    const startSelectedFileComparison = useCallback(() => {
      if (selectedLeftEntry?.kind !== "file" || selectedRightEntry?.kind !== "file") return;
      closeEdit();
      setView("file");
      setSelectedTextRow(0);
      void fileDiff.start(selectedLeftEntry.path, selectedRightEntry.path);
    }, [closeEdit, fileDiff, selectedLeftEntry, selectedRightEntry]);

    useEffect(() => {
      if (!launchRequest || consumedLaunchToken.current === launchRequest.token) return;
      consumedLaunchToken.current = launchRequest.token;
      closeEdit();
      setSelectedFolderRow(0);
      setSelectedTextRow(0);
      if (launchRequest.kind === "file") {
        void left.openPath(parentDirectory(launchRequest.leftPath));
        void right.openPath(parentDirectory(launchRequest.rightPath));
        setView("file");
        void fileDiff.start(launchRequest.leftPath, launchRequest.rightPath);
      } else {
        void left.openPath(launchRequest.leftPath);
        void right.openPath(launchRequest.rightPath);
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
        void active.openPath(path);
      },
      back() {
        closeEdit();
        setView("browse");
        active.back();
      },
      forward() {
        closeEdit();
        setView("browse");
        active.forward();
      },
      up() {
        closeEdit();
        setView("browse");
        active.up();
      },
      moveSelection,
      openSelection,
      nextDifference() {
        void jumpDifference(1);
      },
      previousDifference() {
        void jumpDifference(-1);
      },
      toggleSplit() {
        setSplit((current) => !current);
      },
      activatePane: activatePaneWithFocus,
      findInDirectory() {
        openSearch(activePane);
      },
    }));

    const folderBusy = folderDiff.state.status === "loading";
    const binaryOffset = fileDiff.state.binary?.offset ?? 0;

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
            {view === "browse" ? (
              <button
                className={searchOpen[activePane] ? "icon-button is-active" : "icon-button"}
                type="button"
                title={t("searchDirectoryShortcut")}
                aria-label={t("searchDirectory")}
                aria-pressed={searchOpen[activePane]}
                onClick={() => openSearch(activePane)}
              >
                <Search size={14} />
              </button>
            ) : null}
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
              disabled={selectedLeftEntry?.kind !== "file" || selectedRightEntry?.kind !== "file"}
              onClick={startSelectedFileComparison}
            >
              <FileDiff size={15} /> {t("files")}
            </button>
            <button
              className="command-button is-primary"
              type="button"
              disabled={
                !split ||
                !left.state.path ||
                !right.state.path ||
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

        {view === "browse" ? (
          <div className="compare-browser-surface">
            {comparingSameFolder ? (
              <div className="compare-root-notice" role="status">
                {t("sameFoldersHint")}
              </div>
            ) : null}
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
                emptyLabel={right.search.query.trim() ? t("noMatchingItems") : undefined}
              />
              {right.visibleError ? <div className="pane-error">{right.visibleError}</div> : null}
            </section>
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
        ) : (
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
        )}
      </section>
    );
  },
);
