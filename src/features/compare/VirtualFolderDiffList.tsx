import { CircleAlert, Equal, FileDiff, Minus, Plus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type UIEvent,
} from "react";

import { formatBytes } from "../dedup/duplicateListModel";
import { springTransition } from "../../animation/springPresets";
import { useAppI18n } from "../../i18n/i18n";
import type { CompareStatus, FolderDiffEntry, FolderDiffStatus } from "./types";

const ROW_HEIGHT = 40;
const OVERSCAN = 8;

const STATUS_LABELS: Record<FolderDiffStatus, string> = {
  left_only: "LEFT",
  right_only: "RIGHT",
  different: "DIFF",
  equal: "SAME",
  metadata_only: "TIME",
  error: "ERROR",
};

export interface VirtualFolderDiffListHandle {
  scrollToPosition: (position: number) => void;
}

interface VirtualFolderDiffListProps {
  totalEntries: number;
  status: CompareStatus;
  error?: string | null;
  selectedPosition: number;
  entryAt: (position: number) => FolderDiffEntry | undefined;
  onNeedRange: (start: number, end: number) => void;
  onSelect: (position: number) => void;
  onOpen: (entry: FolderDiffEntry) => void;
  onScrollVelocity: (velocity: number) => void;
}

function StatusIcon({ status }: { status: FolderDiffStatus }) {
  if (status === "left_only") return <Minus size={14} />;
  if (status === "right_only") return <Plus size={14} />;
  if (status === "different") return <FileDiff size={14} />;
  if (status === "error") return <CircleAlert size={14} />;
  return <Equal size={14} />;
}

export const VirtualFolderDiffList = forwardRef<
  VirtualFolderDiffListHandle,
  VirtualFolderDiffListProps
>(function VirtualFolderDiffList(
  {
    totalEntries,
    status,
    error,
    selectedPosition,
    entryAt,
    onNeedRange,
    onSelect,
    onOpen,
    onScrollVelocity,
  },
  ref,
) {
  const { t } = useAppI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastScrollRef = useRef({ top: 0, at: performance.now() });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const reducedMotion = useReducedMotion();

  useImperativeHandle(ref, () => ({
    scrollToPosition(position) {
      const viewport = viewportRef.current;
      if (!viewport || position < 0) return;
      const top = position * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (bottom > viewport.scrollTop + viewport.clientHeight) {
        viewport.scrollTop = bottom - viewport.clientHeight;
      }
    },
  }));

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

  return (
    <div
      className="folder-diff-viewport"
      ref={viewportRef}
      role="grid"
      aria-label={t("folderComparisonResults")}
      aria-rowcount={totalEntries}
      tabIndex={0}
      onScroll={handleScroll}
    >
      <div
        className="folder-diff-spacer"
        style={{ height: Math.max(totalEntries * ROW_HEIGHT, viewportHeight) }}
      >
        {totalEntries === 0 ? (
          <div className="empty-result" role="status">
            {status === "loading"
              ? t("comparingFolders")
              : status === "error"
                ? error ?? t("comparisonUnavailable")
                : t("noComparisonEntries")}
          </div>
        ) : null}
        {Array.from({ length: end - start }, (_, offset) => start + offset).map(
          (position) => {
            const entry = entryAt(position);
            const selected = position === selectedPosition;
            return (
              <motion.div
                className={
                  entry
                    ? `folder-diff-row is-${entry.status}${selected ? " is-selected" : ""}`
                    : "folder-diff-row is-placeholder"
                }
                key={entry?.relative_path ?? `placeholder-${position}`}
                style={{ top: position * ROW_HEIGHT }}
                role="row"
                aria-rowindex={position + 1}
                aria-selected={selected}
                data-selection-item="true"
                initial={reducedMotion ? false : { opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={reducedMotion ? { duration: 0 } : springTransition("snappy", "subtle")}
                onClick={() => entry && onSelect(position)}
                onDoubleClick={() => entry && onOpen(entry)}
                title={entry?.error ?? entry?.relative_path}
              >
                <span className="folder-diff-side left" role="gridcell">
                  <strong>{entry?.left ? entry.relative_path : "-"}</strong>
                  <small>{entry?.left ? formatBytes(entry.left.size) : ""}</small>
                </span>
                <span className="folder-diff-status" role="gridcell">
                  {entry ? <StatusIcon status={entry.status} /> : null}
                  {entry ? STATUS_LABELS[entry.status] : "..."}
                </span>
                <span className="folder-diff-side right" role="gridcell">
                  <strong>{entry?.right ? entry.relative_path : "-"}</strong>
                  <small>{entry?.right ? formatBytes(entry.right.size) : ""}</small>
                </span>
              </motion.div>
            );
          },
        )}
      </div>
    </div>
  );
});
