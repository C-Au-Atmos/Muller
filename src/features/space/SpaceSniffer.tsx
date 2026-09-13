import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { formatSpaceBytes, spaceSnifferClient } from "./spaceSnifferClient";
import type { SpaceNode, SpaceSnifferProps } from "./types";
import { layoutNodes, type SpaceRect } from "./spaceLayout";
import "./SpaceSniffer.css";

interface Point { x: number; y: number; }

const palette = ["#27272a", "#3f3f46", "#52525b", "#27272a", "#454545", "#333338"];
const nodeBytes = (node: SpaceNode): number => node.bytes ?? node.size ?? 0;

function pathParts(path: string): string[] { return path.split(/[\\/]/).filter(Boolean); }
function breadcrumbKey(path: string): string { return pathParts(path).join("\\").toLowerCase(); }

export function SpaceSniffer({ root, client = spaceSnifferClient, onOpenFolder, onSelectionChange, onSoundEvent, className }: SpaceSnifferProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ start: Point; current: Point; dragging: boolean } | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [selected, setSelected] = useState<readonly SpaceNode[]>([]);
  const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null);
  const [activeRoot, setActiveRoot] = useState(root);
  const [rootHistory, setRootHistory] = useState<readonly SpaceNode[]>([]);

  useEffect(() => {
    setActiveRoot(root);
    setRootHistory([]);
  }, [root]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) };
      setSize((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rects = useMemo<SpaceRect[]>(() => layoutNodes(activeRoot.children ?? [], size.width, size.height), [activeRoot.children, size.height, size.width]);
  const selectedIds = useMemo(() => new Set(selected.map((node) => node.id)), [selected]);
  const historyIndexes = useMemo(() => new Map(rootHistory.map((node, index) => [breadcrumbKey(node.path), index])), [rootHistory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(size.width * ratio));
    const pixelHeight = Math.max(1, Math.round(size.height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  }, [size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#09090b";
    context.fillRect(0, 0, size.width, size.height);
    rects.forEach((rect, index) => {
      const isSelected = selectedIds.has(rect.node.id);
      context.fillStyle = palette[index % palette.length] ?? "#27272a";
      context.fillRect(rect.x + 2, rect.y + 2, Math.max(0, rect.width - 4), Math.max(0, rect.height - 4));
      context.strokeStyle = isSelected ? "#fafafa" : "#71717a";
      context.lineWidth = isSelected ? 2 : 1;
      context.strokeRect(rect.x + 1.5, rect.y + 1.5, Math.max(0, rect.width - 3), Math.max(0, rect.height - 3));
      if (rect.width > 88 && rect.height > 34) {
        context.fillStyle = "#fafafa";
        context.font = "12px Segoe UI, sans-serif";
        context.fillText(rect.node.name, rect.x + 10, rect.y + 22, rect.width - 20);
        context.fillStyle = "#a1a1aa";
        context.font = "11px Cascadia Mono, monospace";
        context.fillText(formatSpaceBytes(nodeBytes(rect.node)), rect.x + 10, rect.y + 39, rect.width - 20);
      }
    });
  }, [rects, selectedIds, size]);

  const localPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }, []);
  const hitTest = useCallback((point: Point) => rects.find((rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height)?.node, [rects]);
  const emitSelection = useCallback((nodes: readonly SpaceNode[]) => { setSelected(nodes); onSelectionChange?.(nodes); onSoundEvent?.(nodes.length ? "select" : "hover"); }, [onSelectionChange, onSoundEvent]);
  const restoreHistory = useCallback((index: number) => {
    const previousRoot = rootHistory[index];
    if (!previousRoot) return;
    setActiveRoot(previousRoot);
    setRootHistory((history) => history.slice(0, index));
    setSelected([]);
    onSelectionChange?.([]);
    setMarquee(null);
    pointerRef.current = null;
    onSoundEvent?.("open");
    viewportRef.current?.focus();
  }, [onSelectionChange, onSoundEvent, rootHistory]);
  const openFolder = useCallback((node: SpaceNode) => {
    onSoundEvent?.("open");
    onOpenFolder?.(node);
    if (client.openFolder) {
      void client.openFolder(node).then((nextRoot) => {
        setRootHistory((history) => [...history, activeRoot]);
        setActiveRoot(nextRoot);
        setSelected([]);
      });
    }
  }, [activeRoot, client, onOpenFolder, onSoundEvent]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = localPoint(event);
    pointerRef.current = { start: point, current: point, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    pointer.current = localPoint(event);
    pointer.dragging = Math.hypot(pointer.current.x - pointer.start.x, pointer.current.y - pointer.start.y) > 4;
    if (pointer.dragging) setMarquee({ start: pointer.start, current: pointer.current });
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    const point = localPoint(event);
    if (pointer.dragging) {
      const x = Math.min(pointer.start.x, point.x); const y = Math.min(pointer.start.y, point.y);
      const right = Math.max(pointer.start.x, point.x); const bottom = Math.max(pointer.start.y, point.y);
      emitSelection(rects.filter((rect) => rect.x < right && rect.x + rect.width > x && rect.y < bottom && rect.y + rect.height > y).map((rect) => rect.node));
    } else {
      const node = hitTest(point);
      emitSelection(node ? [node] : []);
    }
    setMarquee(null); pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = hitTest(localPoint(event));
    if (!node || node.kind !== "folder") return;
    openFolder(node);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && rootHistory.length > 0) {
      event.preventDefault();
      restoreHistory(rootHistory.length - 1);
      return;
    }
    if (event.key !== "Enter" || selected.length !== 1) return;
    const node = selected[0];
    if (!node || node.kind !== "folder") return;
    openFolder(node);
  };

  const crumbs = pathParts(activeRoot.path);
  return (
    <section className={`space-sniffer${className ? ` ${className}` : ""}`} aria-label="Space Sniffer">
      <header className="space-sniffer__toolbar">
        <span className="space-sniffer__title">SPACE SNIFFER</span>
        <span className="space-sniffer__status">{formatSpaceBytes(nodeBytes(activeRoot))} · {activeRoot.children?.length ?? activeRoot.childCount ?? 0} items</span>
        <nav className="space-sniffer__crumbs" aria-label="Folder path">
          {crumbs.map((crumb, index) => {
            const historyIndex = historyIndexes.get(crumbs.slice(0, index + 1).join("\\").toLowerCase());
            const isCurrent = index === crumbs.length - 1;
            return <span key={`${crumb}-${index}`}>
              {historyIndex !== undefined ? (
                <button className="space-sniffer__crumb" type="button" onClick={() => restoreHistory(historyIndex)}>{crumb}</button>
              ) : (
                <span className={`space-sniffer__crumb${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "page" : undefined} style={{ cursor: "default" }}>{crumb}</span>
              )}
              {index < crumbs.length - 1 ? <span className="space-sniffer__crumb-separator">/</span> : null}
            </span>;
          })}
        </nav>
      </header>
      <div className="space-sniffer__body">
        <div ref={viewportRef} className="space-sniffer__viewport" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onDoubleClick={handleDoubleClick} onKeyDown={handleKeyDown} role="application" aria-label="Folder space map" tabIndex={0}>
          <canvas ref={canvasRef} className="space-sniffer__canvas" aria-hidden="true" />
          {marquee ? <div className="space-sniffer__marquee" style={{ left: Math.min(marquee.start.x, marquee.current.x), top: Math.min(marquee.start.y, marquee.current.y), width: Math.abs(marquee.current.x - marquee.start.x), height: Math.abs(marquee.current.y - marquee.start.y) }} /> : null}
          <span className="space-sniffer__hint">Click select · double-click open · drag marquee</span>
        </div>
        <aside className="space-sniffer__details" aria-live="polite">
          {selected.length ? <><h2>{selected.length === 1 ? selected[0]?.name : `${selected.length} selected`}</h2><dl><dt>Size</dt><dd>{formatSpaceBytes(selected.reduce((sum, node) => sum + nodeBytes(node), 0))}</dd><dt>Type</dt><dd>{selected.length === 1 ? selected[0]?.kind : "mixed"}</dd><dt>Path</dt><dd title={selected[0]?.path}>{selected.length === 1 ? selected[0]?.path : "Multiple paths"}</dd></dl></> : <p className="space-sniffer__empty">Select a block to inspect its folder size and open it with a double-click.</p>}
        </aside>
      </div>
    </section>
  );
}

export type { SpaceNode, SpaceSnifferClient, SpaceSnifferProps } from "./types";
