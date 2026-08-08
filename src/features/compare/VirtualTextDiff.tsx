import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";

import type { HighlightRange, TextDiffRow } from "./types";
import { useAppI18n } from "../../i18n/i18n";

const ROW_HEIGHT = 24;
const OVERSCAN = 12;

export interface VirtualTextDiffHandle {
  scrollToPosition: (position: number) => void;
}

interface VirtualTextDiffProps {
  totalRows: number;
  selectedPosition: number;
  rowAt: (position: number) => TextDiffRow | undefined;
  onNeedRange: (start: number, end: number) => void;
  onSelect: (position: number) => void;
  onScrollVelocity: (velocity: number) => void;
}

function renderHighlights(text: string | null, ranges: readonly HighlightRange[]): ReactNode {
  if (text === null) return null;
  if (ranges.length === 0) return text || " ";
  const characters = Array.from(text);
  const output: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) output.push(characters.slice(cursor, range.start).join(""));
    output.push(
      <mark key={`${range.start}-${range.end}-${index}`}>
        {characters.slice(range.start, range.end).join("") || " "}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < characters.length) output.push(characters.slice(cursor).join(""));
  return output;
}

export const VirtualTextDiff = forwardRef<VirtualTextDiffHandle, VirtualTextDiffProps>(
  function VirtualTextDiff(
    { totalRows, selectedPosition, rowAt, onNeedRange, onSelect, onScrollVelocity },
    ref,
  ) {
    const { t } = useAppI18n();
    const viewportRef = useRef<HTMLDivElement>(null);
    const lastScrollRef = useRef({ top: 0, at: performance.now() });
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(480);

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
    const start = Math.min(rawStart, Math.max(totalRows - 1, 0));
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(totalRows, start + visibleCount);

    useEffect(() => {
      if (totalRows > 0) onNeedRange(start, end);
    }, [end, onNeedRange, start, totalRows]);

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
        className="text-diff-viewport"
        ref={viewportRef}
        role="grid"
        aria-label={t("textComparison")}
        aria-rowcount={totalRows}
        tabIndex={0}
        onScroll={handleScroll}
      >
        <div
          className="text-diff-spacer"
          style={{ height: Math.max(totalRows * ROW_HEIGHT, viewportHeight) }}
        >
          {Array.from({ length: end - start }, (_, offset) => start + offset).map(
            (position) => {
              const row = rowAt(position);
              return (
                <div
                  className={`text-diff-row is-${row?.tag ?? "loading"}${
                    position === selectedPosition ? " is-selected" : ""
                  }`}
                  key={position}
                  style={{ transform: `translateY(${position * ROW_HEIGHT}px)` }}
                  role="row"
                  aria-rowindex={position + 1}
                  onClick={() => row && onSelect(position)}
                >
                  <span className="line-number">{row?.left_line_number ?? ""}</span>
                  <code>{row ? renderHighlights(row.left_text, row.left_highlights) : t("loading")}</code>
                  <span className="line-number">{row?.right_line_number ?? ""}</span>
                  <code>{row ? renderHighlights(row.right_text, row.right_highlights) : t("loading")}</code>
                </div>
              );
            },
          )}
        </div>
      </div>
    );
  },
);
