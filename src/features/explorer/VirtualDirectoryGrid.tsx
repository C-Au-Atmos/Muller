import { File, Folder, Image, Link2, LoaderCircle } from "lucide-react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { motion, useReducedMotion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
  type UIEvent,
} from "react";

import { pointerFollowTransition, selectionTransition } from "../../animation/springPresets";
import { useAppI18n } from "../../i18n/i18n";
import { isAlbumImageExtension } from "../album/imageFormats";
import type { SelectionModifiers } from "../selection/selectionModel";
import { useMarqueeSelection, type MarqueeRectangle } from "../selection/useMarqueeSelection";
import type { DirectoryPresentation } from "../../workspace/workspaceModel";
import { buildMasonryLayout, masonryNeighbor, visibleMasonryPositions } from "./masonryLayout";
import { createRetargetableScrollController, revealScrollTarget } from "./scrollReveal";
import type { DirectoryEntry, DirectoryStatus } from "./types";
import type { VirtualDirectoryListHandle } from "./VirtualDirectoryList";
import { useShellVisual } from "./useShellVisual";

const GAP = 10;
const DEFAULT_TILE_WIDTH = 150;
const MIN_BLANK_SPACE = 128;

interface VirtualDirectoryGridProps {
  presentation: Exclude<DirectoryPresentation, "list">;
  totalEntries: number;
  status: DirectoryStatus;
  selectedPositions: ReadonlySet<number>;
  focusedPosition: number | null;
  active: boolean;
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
  tileWidth?: number;
  onTileWidthChange?: (width: number) => void;
}

function isImage(entry: DirectoryEntry | undefined): boolean {
  return entry?.kind === "file" && isAlbumImageExtension(entry.extension);
}

function EntryVisual({ entry, size }: { entry: DirectoryEntry; size: number }) {
  const [failedDirectPreviewPath, setFailedDirectPreviewPath] = useState<string | null>(null);
  const animatedGif = entry.kind === "file" && entry.extension?.toLowerCase() === "gif";
  const visual = useShellVisual(
    entry.kind === "file" || entry.kind === "directory" ? entry.path : null,
    Math.min(256, Math.max(64, Math.round(size))),
    "thumbnail-or-icon",
    document.documentElement.dataset.theme ?? "dark",
  );
  if (animatedGif && isTauri() && failedDirectPreviewPath !== entry.path) {
    return (
      <img
        src={convertFileSrc(entry.path)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailedDirectPreviewPath(entry.path)}
      />
    );
  }
  if (visual.status === "ready" && visual.visual?.dataUrl) {
    return <img src={visual.visual.dataUrl} alt="" loading="lazy" decoding="async" draggable={false} />;
  }
  if (entry.kind === "directory") {
    return <span className="folder-object"><span /><Folder size={24} /></span>;
  }
  if (entry.kind === "symlink") return <Link2 size={24} />;
  if (isImage(entry)) return <Image size={24} />;
  return <File size={24} />;
}

export const VirtualDirectoryGrid = forwardRef<VirtualDirectoryListHandle, VirtualDirectoryGridProps>(
  function VirtualDirectoryGrid(
    {
      presentation,
      totalEntries,
      status,
      selectedPositions,
      focusedPosition,
      active,
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
      tileWidth = DEFAULT_TILE_WIDTH,
      onTileWidthChange,
    },
    ref,
  ) {
    const { t } = useAppI18n();
    const viewportRef = useRef<HTMLDivElement>(null);
    const [hoveredPosition, setHoveredPosition] = useState<number | null>(null);
    const scrollControllerRef = useRef<ReturnType<typeof createRetargetableScrollController> | null>(null);
    const previousScroll = useRef({ position: 0, at: performance.now() });
    const [metrics, setMetrics] = useState({ width: 600, height: 480, top: 0 });
    const reducedMotion = useReducedMotion();
    const album = presentation === "album";
    const tileHeight = Math.round(tileWidth + 54);
    const columns = Math.max(1, Math.floor((metrics.width + GAP) / (tileWidth + GAP)));
    const masonry = useMemo(
      () => album ? buildMasonryLayout(totalEntries, columns, metrics.width, GAP) : null,
      [album, columns, metrics.width, totalEntries],
    );
    const visiblePositions = useMemo(() => {
      if (album && masonry) {
        return visibleMasonryPositions(masonry, metrics.top, metrics.height);
      }
      const firstRow = Math.max(0, Math.floor(metrics.top / (tileHeight + GAP)) - 3);
      const rows = Math.ceil(metrics.height / (tileHeight + GAP)) + 6;
      const start = Math.min(totalEntries, firstRow * columns);
      const end = Math.min(totalEntries, (firstRow + rows) * columns);
      return Array.from({ length: end - start }, (_, offset) => start + offset);
    }, [album, columns, masonry, metrics, tileHeight, totalEntries]);
    const visibleStart = visiblePositions[0] ?? 0;
    const visibleEnd = (visiblePositions[visiblePositions.length - 1] ?? -1) + 1;

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

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const wheel = (event: WheelEvent) => {
        scrollControllerRef.current?.cancel();
        if (!event.ctrlKey || album || !onTileWidthChange) return;
        event.preventDefault();
        onTileWidthChange(tileWidth + (event.deltaY < 0 ? 16 : -16));
      };
      viewport.addEventListener("wheel", wheel, { passive: false });
      return () => viewport.removeEventListener("wheel", wheel);
    }, [album, onTileWidthChange, tileWidth]);

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const observer = new ResizeObserver(([entry]) => {
        if (!entry) return;
        setMetrics((current) => ({ ...current, width: entry.contentRect.width, height: entry.contentRect.height }));
      });
      observer.observe(viewport);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      if (visibleEnd > visibleStart) onNeedRange(visibleStart, visibleEnd);
    }, [onNeedRange, visibleEnd, visibleStart]);

    useImperativeHandle(ref, () => ({
      focus: () => viewportRef.current?.focus(),
      scrollToPosition(position) {
        const viewport = viewportRef.current;
        if (!viewport || position < 0) return;
        const masonryItem = album ? masonry?.items[position] : null;
        const itemTop = masonryItem?.y ?? Math.floor(position / columns) * (tileHeight + GAP);
        const itemBottom = itemTop + (masonryItem?.height ?? tileHeight);
        const target = revealScrollTarget(
          viewport.scrollTop,
          viewport.clientHeight,
          itemTop,
          itemBottom,
          album ? masonry?.height ?? itemBottom : Math.ceil(totalEntries / columns) * (tileHeight + GAP),
        );
        if (target !== viewport.scrollTop) {
          scrollControllerRef.current?.reveal("y", target, Boolean(reducedMotion));
        }
      },
      navigationTarget(position, direction) {
        if (totalEntries <= 0) return -1;
        const current = position === null ? 0 : Math.min(Math.max(position, 0), totalEntries - 1);
        if (album && masonry) {
          if (direction === "up" || direction === "down" || direction === "left" || direction === "right") {
            return masonryNeighbor(masonry, current, direction);
          }
          const item = masonry.items[current];
          if (!item) return current;
          const targetY = item.y + (direction === "pageUp" ? -metrics.height : metrics.height);
          const column = masonry.columns.find((items) => items.some((candidate) => candidate.position === current));
          return column?.reduce((best, candidate) =>
            Math.abs(candidate.y - targetY) < Math.abs(best.y - targetY) ? candidate : best,
          item).position ?? current;
        }
        const pageRows = Math.max(1, Math.floor(metrics.height / (tileHeight + GAP)) - 1);
        const delta = direction === "left"
          ? -1
          : direction === "right"
            ? 1
            : direction === "up"
              ? -columns
              : direction === "down"
                ? columns
                : direction === "pageUp"
                  ? -pageRows * columns
                  : pageRows * columns;
        return Math.min(Math.max(current + delta, 0), totalEntries - 1);
      },
    }), [album, columns, masonry, metrics.height, reducedMotion, tileHeight, totalEntries]);

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
      const { scrollTop } = event.currentTarget;
      const nextPosition = scrollTop;
      const now = performance.now();
      const elapsed = Math.max(now - previousScroll.current.at, 1);
      onScrollVelocity(((nextPosition - previousScroll.current.position) / elapsed) * 1000);
      previousScroll.current = { position: nextPosition, at: now };
      setMetrics((current) => ({ ...current, top: scrollTop }));
    };
    const rows = Math.ceil(totalEntries / columns);
    const contentHeight = album
      ? (masonry?.height ?? metrics.height)
      : rows * (tileHeight + GAP);
    const selectedPosition = focusedPosition ?? -1;
    const selectedMasonryItem = album ? masonry?.items[selectedPosition] : null;
    const selectedColumn = selectedPosition % columns;
    const selectedRow = Math.floor(selectedPosition / columns);
    const selectedTileWidth = selectedMasonryItem?.width
      ?? (metrics.width - (columns - 1) * GAP) / columns;
    const selectionTarget = selectedPosition >= 0
      && selectedPosition < totalEntries
      && visiblePositions.includes(selectedPosition)
      ? {
          x: selectedMasonryItem?.x
            ?? selectedColumn * ((metrics.width + GAP) / columns),
          y: selectedMasonryItem?.y ?? selectedRow * (tileHeight + GAP),
          width: selectedTileWidth,
          height: selectedMasonryItem?.height ?? tileHeight,
        }
      : null;
    const hoveredMasonryItem = hoveredPosition === null ? null : album ? masonry?.items[hoveredPosition] : null;
    const hoveredColumn = hoveredPosition === null ? 0 : hoveredPosition % columns;
    const hoveredRow = hoveredPosition === null ? 0 : Math.floor(hoveredPosition / columns);
    const hoverTarget = hoveredPosition !== null && visiblePositions.includes(hoveredPosition) ? {
      x: hoveredMasonryItem?.x ?? hoveredColumn * ((metrics.width + GAP) / columns),
      y: hoveredMasonryItem?.y ?? hoveredRow * (tileHeight + GAP),
      width: hoveredMasonryItem?.width ?? (metrics.width - (columns - 1) * GAP) / columns,
      height: hoveredMasonryItem?.height ?? tileHeight,
    } : null;
    const hover = (position: number | null) => {
      setHoveredPosition(position);
    };
    const emptyLabel = status === "loading" ? t("loadingDirectory") : status === "error" ? t("directoryUnavailable") : customEmptyLabel ?? (album ? t("noImages") : t("emptyDirectory"));

    const hitTest = useMemo(() => (rectangle: MarqueeRectangle): ReadonlySet<number> => {
      const intersects = (x: number, y: number, width: number, height: number) =>
        x < rectangle.x + rectangle.width
        && x + width > rectangle.x
        && y < rectangle.y + rectangle.height
        && y + height > rectangle.y;
      const hits = new Set<number>();
      if (album && masonry) {
        for (const column of masonry.columns) {
          for (const item of column) {
            if (item.y > rectangle.y + rectangle.height) break;
            if (intersects(item.x, item.y, item.width, item.height)) hits.add(item.position);
          }
        }
        return hits;
      }
      const cellWidth = (metrics.width + GAP) / columns;
      const firstRow = Math.max(0, Math.floor(rectangle.y / (tileHeight + GAP)));
      const lastRow = Math.max(firstRow, Math.floor((rectangle.y + rectangle.height) / (tileHeight + GAP)));
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const position = row * columns + column;
          if (position >= totalEntries) break;
          const x = column * cellWidth;
          const y = row * (tileHeight + GAP);
          if (intersects(x, y, cellWidth - GAP, tileHeight)) hits.add(position);
        }
      }
      return hits;
    }, [album, columns, masonry, metrics.width, tileHeight, totalEntries]);

    const marquee = useMarqueeSelection({
      viewportRef,
      axis: "vertical",
      hitTest,
      onStart: onMarqueeStart,
      onChange: onMarqueeChange,
      onBlankClick: (modifiers) => {
        if (!modifiers.ctrl && !modifiers.shift) onClearSelection();
      },
    });

    return (
      <div
        ref={viewportRef}
        className={`directory-grid-viewport is-${presentation}${active ? " is-active" : ""}`}
        role="grid"
        aria-label={album ? t("albumContents") : t("directoryContents")}
        aria-rowcount={totalEntries}
        tabIndex={0}
        onFocus={onActivate}
        onPointerDown={(event) => {
          onActivate();
          marquee.handlePointerDown(event);
        }}
        onPointerMove={marquee.handlePointerMove}
        onPointerUp={marquee.handlePointerUp}
        onPointerCancel={marquee.handlePointerCancel}
        onScroll={handleScroll}
        onPointerLeave={() => hover(null)}
        onContextMenu={(event) => onContextMenu?.(event, null, null)}
      >
        <div
          className="directory-grid-spacer"
          style={{ height: Math.max(metrics.height, contentHeight + MIN_BLANK_SPACE) }}
        >
          {totalEntries === 0 ? <div className="empty-result" role="status">{status === "loading" ? <LoaderCircle className="spin" size={16} /> : null}<span>{emptyLabel}</span></div> : null}
          {visiblePositions.map((position) => {
            const entry = entryAt(position);
            const column = position % columns;
            const row = Math.floor(position / columns);
            const masonryItem = album ? masonry?.items[position] : null;
            return (
              <button
                className={`directory-tile${selectedPositions.has(position) ? " is-selected" : ""}${entry ? "" : " is-placeholder"}`}
                key={entry?.path ?? `placeholder-${position}`}
                type="button"
                role="gridcell"
                aria-selected={selectedPositions.has(position)}
                data-selection-item="true"
                data-drop-directory={entry?.kind === "directory" ? entry.path : undefined}
                draggable={entry?.kind === "file" || entry?.kind === "directory"}
                title={entry?.path}
                style={{
                  width: masonryItem?.width ?? `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`,
                  height: masonryItem?.height ?? tileHeight,
                  transform: masonryItem
                    ? `translate(${masonryItem.x}px, ${masonryItem.y}px)`
                    : `translate(${column * ((metrics.width + GAP) / columns)}px, ${row * (tileHeight + GAP)}px)`,
                }}
                onPointerDown={(event) => {
                  if (!entry || event.button !== 0) return;
                  const selected = selectedPositions.has(position);
                  const plainSelection = !event.ctrlKey && !event.metaKey && !event.shiftKey;
                  if (selected && plainSelection) return;
                  onSelect(position, {
                    ctrl: event.ctrlKey || event.metaKey,
                    shift: event.shiftKey,
                  });
                }}
                onClick={(event) => {
                  if (!entry || marquee.shouldSuppressClick()) return;
                  const selected = selectedPositions.has(position);
                  const plainSelection = !event.ctrlKey && !event.metaKey && !event.shiftKey;
                  if (event.detail === 0 || (selected && selectedPositions.size > 1 && plainSelection)) {
                    onSelect(position, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
                  }
                }}
                onDragStart={(event) => entry && onFileDragStart?.(event, entry, position)}
                onDragEnd={onFileDragEnd}
                onDoubleClick={() => entry && onOpen(entry)}
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
              >
                <span className="directory-tile__visual">{entry ? <EntryVisual entry={entry} size={tileWidth} /> : <LoaderCircle className="spin" size={18} />}</span>
                <span className="directory-tile__name">{entry?.name ?? t("loading")}</span>
                {entry ? <small>{entry.kind === "directory" ? t("folder") : entry.kind === "symlink" ? t("link") : entry.extension?.toUpperCase() ?? t("file")}</small> : null}
              </button>
            );
          })}
          {selectionTarget ? (
            <motion.div
              className="directory-grid-selection"
              initial={false}
              animate={selectionTarget}
              transition={reducedMotion ? { duration: 0 } : selectionTransition()}
              aria-hidden="true"
            />
          ) : null}
          {hoverTarget ? (
            <motion.div
              className="directory-grid-hover"
              initial={false}
              animate={hoverTarget}
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
  },
);
