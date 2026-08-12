import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Link2,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type UIEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { formatBytes } from "../dedup/duplicateListModel";
import { pointerFollowTransition, selectionTransition } from "../../animation/springPresets";
import { useAppI18n, type I18nValue } from "../../i18n/i18n";
import type { SelectionModifiers } from "../selection/selectionModel";
import { useMarqueeSelection } from "../selection/useMarqueeSelection";
import { createRetargetableScrollController, revealScrollTarget } from "./scrollReveal";
import { useShellVisual } from "./useShellVisual";
import {
  DEFAULT_DIRECTORY_COLUMNS,
  directoryColumnTemplate,
  type DirectoryListColumn,
} from "./directoryColumns";
import type { DirectoryEntry, DirectoryStatus } from "./types";

const ROW_HEIGHT = 32;
const OVERSCAN = 8;
const MIN_BLANK_SPACE = 112;

export type DirectoryNavigationDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageUp"
  | "pageDown";

export interface VirtualDirectoryListHandle {
  scrollToPosition: (position: number) => void;
  focus: () => void;
  navigationTarget: (
    position: number | null,
    direction: DirectoryNavigationDirection,
  ) => number;
}

interface VirtualDirectoryListProps {
  totalEntries: number;
  status: DirectoryStatus;
  selectedPositions: ReadonlySet<number>;
  focusedPosition: number | null;
  active: boolean;
  columns?: readonly DirectoryListColumn[];
  entryAt: (position: number) => DirectoryEntry | undefined;
  onNeedRange: (start: number, end: number) => void;
  onSelect: (position: number, modifiers: SelectionModifiers) => void;
  onClearSelection: () => void;
  onMarqueeStart: (modifiers: SelectionModifiers) => void;
  onMarqueeChange: (positions: ReadonlySet<number>) => void;
  onOpen: (entry: DirectoryEntry) => void;
  onActivate: () => void;
  onScrollVelocity: (velocity: number) => void;
  onContextMenu?: (
    event: ReactMouseEvent<HTMLElement>,
    entry: DirectoryEntry | null,
    position: number | null,
  ) => void;
  onFileDragStart?: (
    event: ReactDragEvent<HTMLElement>,
    entry: DirectoryEntry,
    position: number,
  ) => void;
  onFileDragEnd?: () => void;
  emptyLabel?: string;
  hoverDelayMs?: number;
}

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav", "wma"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm", "wmv"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "xz", "zip"]);
const CODE_EXTENSIONS = new Set(["c", "cpp", "css", "go", "html", "java", "js", "json", "jsx", "md", "py", "rs", "sh", "ts", "tsx", "xml", "yaml", "yml"]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "ods", "xls", "xlsx"]);
const TEXT_EXTENSIONS = new Set(["doc", "docx", "log", "odt", "pdf", "rtf", "txt"]);

function fileIcon(extension: string | null): LucideIcon {
  const value = extension?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(value)) return FileImage;
  if (AUDIO_EXTENSIONS.has(value)) return FileAudio;
  if (VIDEO_EXTENSIONS.has(value)) return FileVideo;
  if (ARCHIVE_EXTENSIONS.has(value)) return FileArchive;
  if (CODE_EXTENSIONS.has(value)) return FileCode2;
  if (SPREADSHEET_EXTENSIONS.has(value)) return FileSpreadsheet;
  if (TEXT_EXTENSIONS.has(value)) return FileText;
  return File;
}

function entryTypeLabel(entry: DirectoryEntry, t: I18nValue["t"]): string {
  if (entry.kind === "directory") return t("folder");
  if (entry.kind === "symlink") return t("link");
  return entry.extension ? t("fileType", { extension: entry.extension.toUpperCase() }) : t("file");
}

function formatModified(value: number | null, formatDate: I18nValue["formatDate"]): string {
  if (value === null) return "-";
  return formatDate(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function DirectoryEntryIcon({ entry }: { entry: DirectoryEntry }) {
  const visual = useShellVisual(
    entry.kind === "file" || entry.kind === "directory" ? entry.path : null,
    20,
    "icon",
    document.documentElement.dataset.theme ?? "dark",
  );
  if (visual.status === "ready" && visual.visual?.dataUrl) {
    return <img className="directory-shell-icon" src={visual.visual.dataUrl} alt="" draggable={false} />;
  }
  if (entry.kind === "directory") return <Folder size={17} />;
  if (entry.kind === "symlink") return <Link2 size={17} />;
  const Icon = fileIcon(entry.extension);
  return <Icon size={17} />;
}

export const VirtualDirectoryList = forwardRef<
  VirtualDirectoryListHandle,
  VirtualDirectoryListProps
>(function VirtualDirectoryList(
  {
    totalEntries,
    status,
    selectedPositions,
    focusedPosition,
    active,
    columns = DEFAULT_DIRECTORY_COLUMNS,
    entryAt,
    onNeedRange,
    onSelect,
    onClearSelection,
    onMarqueeStart,
    onMarqueeChange,
    onOpen,
    onActivate,
    onScrollVelocity,
    onContextMenu,
    onFileDragStart,
    onFileDragEnd,
    emptyLabel: customEmptyLabel,
    hoverDelayMs = 0,
  },
  ref,
) {
  const { t, formatDate } = useAppI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollControllerRef = useRef<ReturnType<typeof createRetargetableScrollController> | null>(null);
  const lastScrollRef = useRef({ top: 0, at: performance.now() });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [hoveredPosition, setHoveredPosition] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const controller = createRetargetableScrollController(viewport);
    scrollControllerRef.current = controller;
    return () => {
      controller.cancel();
      scrollControllerRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    focus() {
      viewportRef.current?.focus();
    },
    scrollToPosition(position) {
      const viewport = viewportRef.current;
      if (!viewport || position < 0) return;
      const rowTop = position * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      const target = revealScrollTarget(
        viewport.scrollTop,
        viewport.clientHeight,
        rowTop,
        rowBottom,
        totalEntries * ROW_HEIGHT,
      );
      if (target !== viewport.scrollTop) {
        scrollControllerRef.current?.reveal("y", target, Boolean(reducedMotion));
      }
    },
    navigationTarget(position, direction) {
      if (totalEntries <= 0) return -1;
      const current = position === null ? 0 : position;
      const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1);
      const delta = direction === "up"
        ? -1
        : direction === "down"
          ? 1
          : direction === "pageUp"
            ? -page
            : direction === "pageDown"
              ? page
              : 0;
      return Math.min(Math.max(current + delta, 0), totalEntries - 1);
    },
  }), [reducedMotion, totalEntries, viewportHeight]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const rawStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const start = Math.min(rawStart, Math.max(totalEntries - 1, 0));
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(totalEntries, start + visibleCount);

  const hitTest = useCallback((rectangle: { y: number; height: number }) => {
    if (totalEntries <= 0) return new Set<number>();
    const contentHeight = totalEntries * ROW_HEIGHT;
    if (rectangle.y >= contentHeight) return new Set<number>();
    const first = Math.min(
      totalEntries - 1,
      Math.max(0, Math.floor(rectangle.y / ROW_HEIGHT)),
    );
    const last = Math.min(
      totalEntries - 1,
      Math.max(first, Math.floor((rectangle.y + rectangle.height) / ROW_HEIGHT)),
    );
    return new Set(Array.from({ length: last - first + 1 }, (_, offset) => first + offset));
  }, [totalEntries]);

  const marquee = useMarqueeSelection({
    viewportRef,
    axis: "vertical",
    hitTest,
    blockSelector: '[data-file-drag-handle="true"]',
    onStart: onMarqueeStart,
    onChange: onMarqueeChange,
    onBlankClick: (modifiers) => {
      if (!modifiers.ctrl && !modifiers.shift) onClearSelection();
    },
  });

  useEffect(() => {
    if (totalEntries > 0) onNeedRange(start, end);
  }, [end, onNeedRange, start, totalEntries]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    const now = performance.now();
    const elapsed = Math.max(now - lastScrollRef.current.at, 1);
    onScrollVelocity(((top - lastScrollRef.current.top) / elapsed) * 1000);
    lastScrollRef.current = { top, at: now };
    setScrollTop(top);
  };

  const emptyLabel =
    status === "loading"
      ? t("loadingDirectory")
      : status === "error"
        ? t("directoryUnavailable")
        : customEmptyLabel ?? t("emptyDirectory");
  const visiblePositions = useMemo(
    () => Array.from({ length: end - start }, (_, offset) => start + offset),
    [end, start],
  );
  const hoverVisible = hoveredPosition !== null
    && visiblePositions.includes(hoveredPosition);
  const focusVisible = focusedPosition !== null
    && selectedPositions.has(focusedPosition)
    && visiblePositions.includes(focusedPosition);
  const animatedFocusVisible = focusVisible && selectedPositions.size === 1;
  const hover = (position: number | null) => {
    setHoveredPosition(position);
  };
  const gridTemplateColumns = directoryColumnTemplate(columns);

  return (
    <div
      className={active ? "directory-list-viewport is-active" : "directory-list-viewport"}
      ref={viewportRef}
      role="grid"
      aria-label={t("directoryContents")}
      aria-rowcount={totalEntries}
      tabIndex={0}
      onFocus={onActivate}
      onPointerDown={(event) => {
        scrollControllerRef.current?.cancel();
        onActivate();
        marquee.handlePointerDown(event);
      }}
      onPointerMove={marquee.handlePointerMove}
      onPointerUp={marquee.handlePointerUp}
      onPointerCancel={marquee.handlePointerCancel}
      onWheel={() => scrollControllerRef.current?.cancel()}
      onScroll={handleScroll}
      onPointerLeave={() => hover(null)}
      onContextMenu={(event) => onContextMenu?.(event, null, null)}
    >
      <div
        className="directory-list-spacer"
        style={{ height: Math.max(totalEntries * ROW_HEIGHT + MIN_BLANK_SPACE, viewportHeight) }}
      >
        {totalEntries === 0 ? (
          <div className="empty-result" role="status">
            {status === "loading" ? <LoaderCircle className="spin" size={16} /> : null}
            <span>{emptyLabel}</span>
          </div>
        ) : null}
        {visiblePositions.map(
          (position) => {
            const entry = entryAt(position);
            const selected = selectedPositions.has(position);
            return (
              <div
                className={
                  entry
                    ? selected
                      ? "directory-row is-selected"
                      : "directory-row"
                    : "directory-row is-placeholder"
                }
                key={entry?.path ?? `placeholder-${position}`}
                style={{
                  transform: `translateY(${position * ROW_HEIGHT}px)`,
                  gridTemplateColumns,
                }}
                role="row"
                aria-rowindex={position + 1}
                aria-selected={selected}
                data-focused={focusedPosition === position ? "true" : undefined}
                data-selection-item="true"
                data-file-drag-handle={selected ? "true" : undefined}
                data-drop-directory={entry?.kind === "directory" ? entry.path : undefined}
                draggable={selected && (entry?.kind === "file" || entry?.kind === "directory")}
                onPointerDown={(event) => {
                  if (!entry || event.button !== 0) return;
                  const startedOnDragHandle = Boolean(
                    (event.target as Element).closest('[data-file-drag-handle="true"]'),
                  );
                  if (!startedOnDragHandle) return;
                  const plainSelection = !event.ctrlKey && !event.metaKey && !event.shiftKey;
                  if (selected && plainSelection) return;
                  onSelect(position, {
                    ctrl: event.ctrlKey || event.metaKey,
                    shift: event.shiftKey,
                  });
                }}
                onClick={(event) => {
                  if (!entry || marquee.shouldSuppressClick()) return;
                  const plainSelection = !event.ctrlKey && !event.metaKey && !event.shiftKey;
                  if (selected && selectedPositions.size > 1 && plainSelection) {
                    onSelect(position, { ctrl: false, shift: false });
                    return;
                  }
                  const endedOnDragHandle = Boolean(
                    (event.target as Element).closest('[data-file-drag-handle="true"]'),
                  );
                  if (!endedOnDragHandle || event.detail === 0) {
                    onSelect(position, {
                      ctrl: event.ctrlKey || event.metaKey,
                      shift: event.shiftKey,
                    });
                  }
                }}
                onDoubleClick={() => entry && onOpen(entry)}
                onDragStart={(event) => entry && onFileDragStart?.(event, entry, position)}
                onDragEnd={onFileDragEnd}
                onPointerEnter={() => entry && hover(position)}
                onPointerLeave={(event) => {
                  const next = event.relatedTarget instanceof Element
                    ? event.relatedTarget.closest('[data-selection-item="true"]')
                    : null;
                  if (!next && hoveredPosition === position) hover(null);
                }}
                onContextMenu={(event) => {
                  if (!entry) return;
                  event.stopPropagation();
                  onContextMenu?.(event, entry, position);
                }}
                title={entry?.path}
              >
                {selected && !animatedFocusVisible ? <div className="selection-surface" /> : null}
                <span
                  className={`directory-kind${entry?.extension ? ` is-${entry.extension.toLowerCase()}` : ""}`}
                  aria-hidden="true"
                  data-file-drag-handle="true"
                  draggable={entry?.kind === "file" || entry?.kind === "directory"}
                >
                  {entry ? <DirectoryEntryIcon entry={entry} /> : null}
                  {!entry ? <File size={17} /> : null}
                </span>
                {columns.map((column) => {
                  if (column === "name") return (
                    <span
                      className="directory-name"
                      role="gridcell"
                      key={column}
                    >
                      <span
                        className="directory-drag-label"
                        data-file-drag-handle="true"
                        draggable={entry?.kind === "file" || entry?.kind === "directory"}
                      >
                        {entry?.name ?? t("loading")}
                      </span>
                    </span>
                  );
                  if (column === "type") return <span className="directory-type" role="gridcell" key={column}>{entry ? entryTypeLabel(entry, t) : ""}</span>;
                  if (column === "size") return <span className="directory-size" role="gridcell" key={column}>{entry && entry.kind === "file" ? formatBytes(entry.size) : "-"}</span>;
                  return <span className="directory-modified" role="gridcell" key={column}>{entry ? formatModified(entry.modifiedUnixMs, formatDate) : ""}</span>;
                })}
              </div>
            );
          },
        )}
        {animatedFocusVisible ? (
          <motion.div
            className="directory-list-selection"
            initial={false}
            animate={{ y: (focusedPosition ?? 0) * ROW_HEIGHT + 2, height: ROW_HEIGHT - 4 }}
            transition={reducedMotion ? { duration: 0 } : selectionTransition()}
            aria-hidden="true"
          />
        ) : null}
        {hoverVisible ? (
          <motion.div
            className="directory-list-hover"
            initial={false}
            animate={{ y: hoveredPosition * ROW_HEIGHT, height: ROW_HEIGHT }}
            transition={reducedMotion ? { duration: 0 } : pointerFollowTransition(hoverDelayMs)}
            aria-hidden="true"
          />
        ) : null}
        {marquee.rectangle ? (
          <div
            className="selection-marquee"
            style={{
              transform: `translate(${marquee.rectangle.x}px, ${marquee.rectangle.y}px)`,
              width: marquee.rectangle.width,
              height: marquee.rectangle.height,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
});
