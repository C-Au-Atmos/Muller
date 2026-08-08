import { Copy, Files, Link2, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type UIEvent,
} from "react";

import { useAppI18n } from "../../i18n/i18n";
import { springTransition } from "../../animation/springPresets";
import { displayPath } from "../explorer/pathDisplay";
import type { DuplicateDecision, DuplicateDecisionMap } from "./duplicateDecisionModel";
import { formatBytes, type DuplicateListRow } from "./duplicateListModel";
import type { DuplicateGroup } from "./types";

const ROW_HEIGHT = 40;
const OVERSCAN = 8;

export interface VirtualDuplicateListHandle {
  focus: () => void;
  scrollToPosition: (position: number) => void;
}

interface VirtualDuplicateListProps {
  rows: readonly DuplicateListRow[];
  focusPosition: number;
  selectedPaths: ReadonlySet<string>;
  decisions: DuplicateDecisionMap;
  status: "idle" | "starting" | "scanning" | "done" | "cancelled" | "error";
  onSelect: (position: number, modifiers: { ctrl: boolean; shift: boolean }) => void;
  onDecision: (path: string, decision: DuplicateDecision) => void;
  onOpenGroup: (group: DuplicateGroup) => void;
  onScrollVelocity: (velocity: number) => void;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

function parentPath(path: string): string {
  const end = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return end > 0 ? path.slice(0, end) : path;
}

export const VirtualDuplicateList = forwardRef<
  VirtualDuplicateListHandle,
  VirtualDuplicateListProps
>(function VirtualDuplicateList(
  { rows, focusPosition, selectedPaths, decisions, status, onSelect, onDecision, onOpenGroup, onScrollVelocity },
  ref,
) {
  const { t, formatNumber, formatDate } = useAppI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastScrollRef = useRef({ top: 0, at: performance.now() });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const reducedMotion = useReducedMotion();

  useImperativeHandle(ref, () => ({
    focus() {
      viewportRef.current?.focus();
    },
    scrollToPosition(position) {
      const viewport = viewportRef.current;
      if (!viewport || position < 0) return;
      const rowTop = position * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < viewport.scrollTop) {
        viewport.scrollTop = rowTop;
      } else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
        viewport.scrollTop = rowBottom - viewport.clientHeight;
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

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    const now = performance.now();
    const elapsed = Math.max(now - lastScrollRef.current.at, 1);
    onScrollVelocity(((top - lastScrollRef.current.top) / elapsed) * 1000);
    lastScrollRef.current = { top, at: now };
    setScrollTop(top);
  };

  const unclampedStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const start = Math.min(unclampedStart, Math.max(rows.length - 1, 0));
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(rows.length, start + visibleCount);
  const positions = Array.from({ length: end - start }, (_, offset) => start + offset);
  const emptyLabel =
    status === "scanning" || status === "starting"
      ? t("statusScanning")
      : status === "cancelled"
        ? t("scanCancelled")
        : status === "error"
          ? t("scanFailed")
          : t("noDuplicateGroups");

  return (
    <div
      className="duplicate-list-viewport"
      ref={viewportRef}
      onScroll={handleScroll}
      role="grid"
      aria-label={t("duplicateResults")}
      aria-rowcount={rows.length}
      tabIndex={0}
    >
      <div
        className="duplicate-list-spacer"
        style={{ height: Math.max(rows.length * ROW_HEIGHT, viewportHeight) }}
      >
        {rows.length === 0 ? (
          <div className="empty-result" role="status">
            {emptyLabel}
          </div>
        ) : null}
        {positions.map((position) => {
          const row = rows[position];
          if (!row) return null;
          if (row.kind === "group") {
            const reclaimable = row.group.files.reduce(
              (total, file, fileIndex) =>
                fileIndex === row.group.suggested_keep || file.hard_link_count > 1
                  ? total
                  : total + file.size,
              0,
            );
            return (
              <motion.button
                className="duplicate-group-row"
                type="button"
                key={`group-${row.group.full_hash}`}
                style={{ top: position * ROW_HEIGHT }}
                role="row"
                aria-rowindex={position + 1}
                data-selection-item="true"
                initial={reducedMotion ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={reducedMotion ? { duration: 0 } : springTransition("snappy", "subtle")}
                onClick={() => onOpenGroup(row.group)}
              >
                <Files size={16} />
                <strong>{t("group", { count: formatNumber(row.groupIndex + 1) })}</strong>
                <span>{t("itemCount", { count: formatNumber(row.group.files.length) })}</span>
                <span>{t("reclaimable", { size: formatBytes(reclaimable) })}</span>
                <code>{row.group.full_hash.slice(0, 12)}</code>
              </motion.button>
            );
          }

          const selected = selectedPaths.has(row.file.path);
          const focused = position === focusPosition;
          const suggestionKeep = row.fileIndex === row.group.suggested_keep;
          const decision = decisions.get(row.file.path);
          const decisionLabel = decision === "keep"
            ? "KEEP"
            : decision === "duplicate"
              ? "DUP"
              : suggestionKeep ? "SUGGEST KEEP" : "SUGGEST DUP";
          return (
            <motion.button
              className={`duplicate-file-row${selected ? " is-selected" : ""}${focused ? " is-focused" : ""}${decision === "keep" ? " is-keep" : decision === "duplicate" ? " is-discard" : ""}`}
              type="button"
              key={`${row.group.full_hash}-${row.file.path}`}
              style={{ top: position * ROW_HEIGHT }}
              role="row"
              aria-rowindex={position + 1}
              aria-selected={selected}
              data-selection-item="true"
              initial={reducedMotion ? false : { opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              transition={reducedMotion ? { duration: 0 } : springTransition("snappy", "subtle")}
              onClick={(event) => {
                onSelect(position, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
                onDecision(row.file.path, "keep");
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect(position, { ctrl: false, shift: false });
                onDecision(row.file.path, "duplicate");
              }}
              title={displayPath(row.file.path)}
            >
              {selected ? <div className="selection-surface" /> : null}
              <span className="duplicate-file-icon">
                {decision === "keep" || (!decision && suggestionKeep) ? <ShieldCheck size={16} /> : <Copy size={16} />}
              </span>
              <span className="duplicate-file-name" role="gridcell">
                <strong>{fileName(row.file.path)}</strong>
                <small>{displayPath(parentPath(row.file.path))}</small>
              </span>
              <span role="gridcell" title={row.file.created_unix_ms === null ? t("unknown") : formatDate(row.file.created_unix_ms, { dateStyle: "short", timeStyle: "short" })}>{row.file.created_unix_ms === null ? t("unknown") : formatDate(row.file.created_unix_ms, { dateStyle: "short", timeStyle: "short" })}</span>
              <span role="gridcell" title={row.file.modified_unix_ms === null ? t("unknown") : formatDate(row.file.modified_unix_ms, { dateStyle: "short", timeStyle: "short" })}>{row.file.modified_unix_ms === null ? t("unknown") : formatDate(row.file.modified_unix_ms, { dateStyle: "short", timeStyle: "short" })}</span>
              <span role="gridcell">{formatBytes(row.file.size)}</span>
              <span className={decision === "keep" ? "decision-keep" : decision === "duplicate" ? "decision-duplicate" : "decision-suggested"} role="gridcell" title={t("physicalLinks", { count: formatNumber(row.file.hard_link_count) })}>
                {row.file.hard_link_count > 1 ? <Link2 size={12} /> : null}{decisionLabel}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
});
