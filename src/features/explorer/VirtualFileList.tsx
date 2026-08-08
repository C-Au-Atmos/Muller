import {
  Archive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
} from "lucide-react";
import { motion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type UIEvent,
} from "react";

import { springTransition } from "../../animation/springPresets";
import { useAppI18n } from "../../i18n/i18n";
import { fileAt, type FileKind } from "./fileData";

const ROW_HEIGHT = 40;
const OVERSCAN = 8;

export interface VirtualFileListHandle {
  scrollToPosition: (position: number) => void;
}

interface VirtualFileListProps {
  indices: readonly number[];
  selectedIndex: number;
  loadMs: number;
  onSelect: (index: number) => void;
  onScrollVelocity: (velocity: number) => void;
}

function FileIcon({ kind }: { kind: FileKind }) {
  const props = { size: 17, strokeWidth: 1.7, "aria-hidden": true } as const;

  switch (kind) {
    case "code":
      return <FileCode2 {...props} />;
    case "image":
      return <FileImage {...props} />;
    case "archive":
      return <Archive {...props} />;
    case "audio":
      return <FileAudio {...props} />;
    case "document":
      return <FileText {...props} />;
  }
}

function occupyMainThread(milliseconds: number): void {
  if (milliseconds <= 0) return;
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {
    // The spike intentionally exposes a controlled main-thread pressure input.
  }
}

export const VirtualFileList = forwardRef<
  VirtualFileListHandle,
  VirtualFileListProps
>(function VirtualFileList(
  { indices, selectedIndex, loadMs, onSelect, onScrollVelocity },
  ref,
) {
  const { t, formatNumber } = useAppI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastScrollRef = useRef({ top: 0, at: performance.now() });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useImperativeHandle(ref, () => ({
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
    const velocity = ((top - lastScrollRef.current.top) / elapsed) * 1000;

    lastScrollRef.current = { top, at: now };
    setScrollTop(top);
    onScrollVelocity(velocity);
    occupyMainThread(loadMs);
  };

  const unclampedStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const start = Math.min(unclampedStart, Math.max(indices.length - 1, 0));
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(indices.length, start + visibleCount);
  const positions = Array.from({ length: end - start }, (_, offset) => start + offset);

  return (
    <div
      className="file-list-viewport"
      ref={viewportRef}
      onScroll={handleScroll}
      role="grid"
      aria-label={t("fileResults")}
      aria-rowcount={indices.length}
      tabIndex={0}
    >
      <div
        className="file-list-spacer"
        style={{ height: Math.max(indices.length * ROW_HEIGHT, viewportHeight) }}
      >
        {indices.length === 0 ? (
          <div className="empty-result" role="status">
            {t("noMatchingFiles")}
          </div>
        ) : null}
        {positions.map((position) => {
          const fileIndex = indices[position];
          if (fileIndex === undefined) return null;
          const file = fileAt(fileIndex);
          const selected = fileIndex === selectedIndex;

          return (
            <div
              className={selected ? "file-row is-selected" : "file-row"}
              key={file.id}
              style={{ transform: `translateY(${position * ROW_HEIGHT}px)` }}
              role="row"
              aria-rowindex={position + 1}
              aria-selected={selected}
              onClick={() => onSelect(fileIndex)}
            >
              {selected ? (
                <motion.div
                  className="selection-surface"
                  layoutId="file-selection"
                  transition={springTransition("snappy")}
                />
              ) : null}
              <span className={`file-kind kind-${file.kind}`}>
                <FileIcon kind={file.kind} />
              </span>
              <span className="file-name" role="gridcell">
                {file.name}
              </span>
              <span className="file-folder" role="gridcell">
                {file.folder}
              </span>
              <span className="file-size" role="gridcell">
                {file.size}
              </span>
              <span className="file-modified" role="gridcell">
                {file.modified}
              </span>
              <span className="duplicate-cell" role="gridcell">
                {file.duplicateCount > 0 ? t("copies", { count: formatNumber(file.duplicateCount) }) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
