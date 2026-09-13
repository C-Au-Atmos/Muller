import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { formatSpaceBytes, spaceSnifferClient } from "./spaceSnifferClient";
import type { SpaceContextAction, SpaceNode, SpaceScanProgress, SpaceSnifferProps } from "./types";
import { buildSpaceMapLayout, findDirectionalSpaceRect, interpolateSpaceRects, spaceNodeBytes, type SpaceDirection, type SpaceRect } from "./spaceLayout";
import { registerTargetCursorSurface } from "../feedback/targetCursorRegistry";
import { isImeCompositionEvent } from "../../input/imeInput";
import { spaceParentPath } from "./spaceNavigation";
import { PreviewPanel } from "../preview/PreviewPanel";
import type { DirectoryEntry } from "../explorer/types";
import "./SpaceSniffer.css";

interface Point { x: number; y: number; }
const palette = [["#22282b", "#101416"], ["#202326", "#0d1012"], ["#29252c", "#131116"], ["#1c292c", "#0d1517"], ["#292722", "#151310"], ["#252b30", "#11171b"]];
const copy = {
  "en-US": { title: "Space map", items: "items", scanned: "scanned", scanning: "Scanning", complete: "Scan complete", stopped: "Scan stopped", failed: "Scan interrupted", stop: "Stop", legend: "Area = scanned bytes", seams: "Fine lines = folder boundaries", hint: "Click to select · Double-click to open · Drag to select", selected: "Selected item", size: "Size", share: "Of this folder", contents: "Contents", folder: "Folder", file: "File", path: "Path", open: "Open folder", empty: "Select a block to inspect its size and contents.", other: "Smaller items", otherHint: "Combined at their actual size. Choose an item below to inspect or open it.", noBytes: "Discovering folders and file sizes…", zero: "No measured file bytes in this folder", partial: "Incomplete scan", keyboard: "Enter to open · Esc to return", selectItems: "Select a block", more: "Show more", of: "of", openWith: "Open with…", locate: "Locate in browser", copy: "Copy", cut: "Cut", paste: "Paste", copyName: "Copy file name", copyPath: "Copy full path · 复制路径", terminal: "Open in terminal", extractCurrent: "Extract to current folder", extractNamed: "Extract to named folder", extractChoose: "Choose extraction folder…", compress: "Compress selection to ZIP", rename: "Rename", recycle: "Recycle", properties: "Properties", refresh: "Refresh", newFolder: "New folder", newText: "New text document", newEmpty: "New empty file", organize: "Custom organize" },
  "zh-CN": { title: "空间视图", items: "项", scanned: "已扫描", scanning: "扫描中", complete: "扫描完成", stopped: "扫描已停止", failed: "扫描中断", stop: "停止", legend: "面积 = 已扫描字节数", seams: "细线 = 文件夹层级边界", hint: "单击选择 · 双击打开 · 拖动框选", selected: "选中项", size: "大小", share: "占当前目录", contents: "内容", folder: "文件夹", file: "文件", path: "路径", open: "打开文件夹", empty: "选择一个方块，查看大小和内容。", other: "较小项目", otherHint: "按实际总大小合并。可在下方选择项目查看或打开。", noBytes: "正在发现文件夹并统计大小…", zero: "此文件夹暂无已统计文件字节", partial: "统计不完整", keyboard: "Enter 打开 · Esc 返回", selectItems: "选择一个方块", more: "显示更多", of: "/", openWith: "打开方式…", locate: "在浏览器中定位", copy: "复制", cut: "剪切", paste: "粘贴", copyName: "复制文件名", copyPath: "复制完整路径", terminal: "在终端中打开", extractCurrent: "解压到当前文件夹", extractNamed: "解压到同名文件夹", extractChoose: "选择解压目标…", compress: "将所选项压缩为 ZIP", rename: "重命名", recycle: "移入回收站", properties: "属性", refresh: "刷新", newFolder: "新建文件夹", newText: "新建文本文档", newEmpty: "新建空文件", organize: "自定义收纳" },
} as const;
type SpaceCopy = typeof copy[keyof typeof copy];
function pathParts(path: string): string[] { return path.split(/[\\/]/).filter(Boolean); }
function breadcrumbKey(path: string): string { return pathParts(path).join("\\").toLowerCase(); }
function colorIndex(id: string): number { let hash = 0; for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0; return Math.abs(hash) % palette.length; }
function ellipsis(context: CanvasRenderingContext2D, value: string, width: number): string {
  if (context.measureText(value).width <= width) return value;
  let start = 0; let end = value.length;
  while (start < end) { const middle = Math.ceil((start + end) / 2); if (context.measureText(`${value.slice(0, middle)}…`).width <= width) start = middle; else end = middle - 1; }
  return `${value.slice(0, start)}…`;
}
function drawMap(context: CanvasRenderingContext2D, rects: readonly SpaceRect[], width: number, height: number, selected: ReadonlySet<string>, hovered: string | null, words: SpaceCopy, total: number) {
  const ratio = window.devicePixelRatio || 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#121215"; context.fillRect(0, 0, width, height);
  for (const rect of rects) {
    if (rect.width < .1 || rect.height < .1) continue;
    const isSelected = selected.has(rect.node.id);
    const colors = palette[colorIndex(rect.node.id)]!;
    const gradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    gradient.addColorStop(0, colors[0]!); gradient.addColorStop(1, colors[1]!);
    context.fillStyle = gradient; context.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (hovered === rect.node.id) { context.fillStyle = "rgba(255,255,255,.035)"; context.fillRect(rect.x, rect.y, rect.width, rect.height); }
    context.strokeStyle = "rgba(255,255,255,.34)"; context.lineWidth = .75;
    context.strokeRect(rect.x + .5, rect.y + .5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1));
    context.save(); context.beginPath(); context.rect(rect.x + 5, rect.y + 5, Math.max(0, rect.width - 10), Math.max(0, rect.height - 10)); context.clip();
    const roomy = rect.width >= 200 && rect.height >= 130;
    const inset = roomy ? 20 : 11;
    if (rect.width >= 58 && rect.height >= 27) {
      context.fillStyle = "#fafafa"; context.font = `${roomy ? "600 17" : "500 12"}px Segoe UI, sans-serif`;
      const title = rect.members ? `${words.other} · ${rect.members.length}` : rect.node.name;
      context.fillText(ellipsis(context, title, Math.max(0, rect.width - inset * 2)), rect.x + inset, rect.y + inset + (roomy ? 16 : 12));
      if (rect.height >= 57 && rect.width >= 82) {
        context.fillStyle = "#a1a1aa"; context.font = `${roomy ? 12 : 10}px Segoe UI, sans-serif`;
        const percent = total > 0 ? ` · ${(spaceNodeBytes(rect.node) / total * 100).toFixed(1)}%` : "";
        context.fillText(ellipsis(context, `${formatSpaceBytes(spaceNodeBytes(rect.node))}${percent}`, rect.width - inset * 2), rect.x + inset, rect.y + inset + (roomy ? 39 : 30));
      }
    }
    // The approved SVG uses an open, orthogonal accent inside large tiles.
    // It does not enclose areas or represent children; drill in to operate on
    // the next folder level instead of drawing non-interactive miniature tiles.
    if (roomy && rect.height > 175 && rect.node.kind === "folder" && !rect.members) {
      const left = rect.x + 22; const right = rect.x + rect.width - 26;
      const top = rect.y + 84; const step = Math.min(28, (rect.height - 112) / 3);
      const turn = Math.min(74, (right - left) * .24);
      context.strokeStyle = "rgba(255,255,255,.22)"; context.lineWidth = .75;
      context.beginPath(); context.moveTo(left, top); context.lineTo(right, top);
      context.lineTo(right, top + step); context.lineTo(right - turn, top + step);
      context.lineTo(right - turn, top + step * 2); context.lineTo(right, top + step * 2);
      context.stroke();
    }
    context.restore();
    if (isSelected && rect.width > 3 && rect.height > 3) {
      context.save(); context.strokeStyle = "#fff"; context.lineWidth = 1.4; context.shadowColor = "rgba(255,255,255,.6)"; context.shadowBlur = 8;
      context.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3); context.shadowBlur = 0;
      const corner = Math.min(15, rect.width / 4, rect.height / 4);
      context.lineWidth = 2; context.beginPath();
      for (const [cx, cy, dx, dy] of [[rect.x + 2, rect.y + 2, 1, 1], [rect.x + rect.width - 2, rect.y + 2, -1, 1], [rect.x + 2, rect.y + rect.height - 2, 1, -1], [rect.x + rect.width - 2, rect.y + rect.height - 2, -1, -1]]) {
        context.moveTo(cx! + dx! * corner, cy!); context.lineTo(cx!, cy!); context.lineTo(cx!, cy! + dy! * corner);
      }
      context.stroke(); context.restore();
    }
  }
}

export function SpaceSniffer({ ref, root, rootRequestId = 0, progress, client = spaceSnifferClient, onOpenFolder, onCancelScan, onSelectionChange, onSoundEvent, onContextAction, onNavigationChange, showBreadcrumbs = true, mediaAutoplay = false, onMediaAutoplayChange, className }: SpaceSnifferProps) {
  const { locale, formatNumber, t } = useAppI18n(); const words = copy[locale];
  const canvasRef = useRef<HTMLCanvasElement>(null); const viewportRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const pointerRef = useRef<{ start: Point; current: Point; dragging: boolean } | null>(null);
  const displayedRectsRef = useRef<readonly SpaceRect[]>([]); const paintRef = useRef<(rects: readonly SpaceRect[]) => void>(() => undefined);
  const drillRef = useRef<{ controller: AbortController; generation: number } | null>(null); const generationRef = useRef(0);
  const externalRootRef = useRef(root); const animationPathRef = useRef(root.path);
  const externalRequestRef = useRef(rootRequestId);
  const historyProgressRef = useRef(new Map<string, SpaceScanProgress>());
  const [size, setSize] = useState({ width: 1, height: 1 }); const [selected, setSelected] = useState<readonly SpaceNode[]>([]);
  const [hovered, setHovered] = useState<string | null>(null); const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null);
  const [activeRoot, setActiveRoot] = useState(root); const [rootHistory, setRootHistory] = useState<readonly SpaceNode[]>([]);
  const [forwardHistory, setForwardHistory] = useState<readonly SpaceNode[]>([]);
  const [localProgress, setLocalProgress] = useState<SpaceScanProgress | null>(null); const [groupOpen, setGroupOpen] = useState(false); const [groupLimit, setGroupLimit] = useState(60);
  const [detailsWidth, setDetailsWidth] = useState(248);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: SpaceNode | null } | null>(null);
  const activeProgress = localProgress ?? progress; const scanning = activeProgress?.phase === "scanning";
  const total = spaceNodeBytes(activeRoot);
  const { rects, grouped } = useMemo(() => buildSpaceMapLayout(activeRoot.children ?? [], size.width, size.height, activeRoot.id), [activeRoot.children, activeRoot.id, size]);
  const currentNodes = useMemo(() => new Map((activeRoot.children ?? []).map((node) => [node.id, node])), [activeRoot.children]);
  const currentSelection = selected.map((node) => currentNodes.get(node.id) ?? node);
  const selectedIds = useMemo(() => new Set(selected.map((node) => node.id)), [selected]);
  const selectedRectIds = useMemo(() => {
    if (!selectedIds.size) return new Set<string>();
    return new Set(rects.filter((rect) => rect.members ? rect.members.some((node) => selectedIds.has(node.id)) : selectedIds.has(rect.node.id)).map((rect) => rect.node.id));
  }, [rects, selectedIds]);
  const historyIndexes = useMemo(() => new Map(rootHistory.map((node, index) => [breadcrumbKey(node.path), index])), [rootHistory]);
  useEffect(() => {
    if (externalRootRef.current === root && externalRequestRef.current === rootRequestId) return;
    const changedPath = externalRootRef.current.path !== root.path || externalRequestRef.current !== rootRequestId;
    externalRootRef.current = root;
    externalRequestRef.current = rootRequestId;
    if (changedPath) {
      generationRef.current += 1; drillRef.current?.controller.abort(); drillRef.current = null;
      historyProgressRef.current.set(activeRoot.path, activeProgress ?? { phase: "complete", scanned: 0, total: null });
      if (activeRoot.path !== root.path) { setRootHistory((history) => [...history, activeRoot]); setForwardHistory([]); }
      setActiveRoot(root); setSelected([]); setLocalProgress(null); setGroupOpen(false); setContextMenu(null); setPreviewOpen(false);
    } else {
      setActiveRoot((current) => current.path === root.path ? root : current);
      setRootHistory((history) => history.map((node) => node.path === root.path ? root : node));
      setForwardHistory((history) => history.map((node) => node.path === root.path ? root : node));
    }
  }, [activeProgress, activeRoot, root, rootRequestId]);
  useEffect(() => () => { generationRef.current += 1; drillRef.current?.controller.abort(); }, []);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && (event.target as HTMLElement | null)?.closest(".space-sniffer__context-menu")) return;
      setContextMenu(null);
    };
    window.addEventListener("keydown", close); window.addEventListener("mousedown", close);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("mousedown", close); };
  }, [contextMenu]);
  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const resize = resizeRef.current; const body = bodyRef.current;
      if (!resize || !body) return;
      const available = body.getBoundingClientRect().width;
      const max = Math.max(260, Math.min(460, available - 300));
      const next = Math.min(max, Math.max(180, resize.startWidth - (event.clientX - resize.startX)));
      setDetailsWidth(next);
    };
    const handleUp = () => { resizeRef.current = null; };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => { window.removeEventListener("pointermove", handleMove); window.removeEventListener("pointerup", handleUp); };
  }, []);
  useEffect(() => {
    const element = viewportRef.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return; const next = { width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) };
      setSize((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current; const context = canvas?.getContext("2d"); if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1; const pixelWidth = Math.max(1, Math.round(size.width * ratio)); const pixelHeight = Math.max(1, Math.round(size.height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth; if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
    paintRef.current = (frame) => drawMap(context, frame, size.width, size.height, selectedRectIds, hovered, words, total);
    paintRef.current(displayedRectsRef.current);
  }, [hovered, selectedRectIds, size, total, words]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const samePath = animationPathRef.current === activeRoot.path; animationPathRef.current = activeRoot.path;
    const previous = new Map((samePath ? displayedRectsRef.current : []).map((rect) => [rect.node.id, rect]));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(canvas.closest('[data-motion="reduced"]'));
    const start = performance.now(); let frameId = 0;
    canvas.dataset.animationState = reduced ? "settled" : "animating";
    const render = (now: number) => {
      const elapsed = reduced ? 1 : Math.min(1, (now - start) / 280); const eased = 1 - (1 - elapsed) ** 3;
      const frame = elapsed === 1 ? rects : interpolateSpaceRects(previous, rects, eased);
      displayedRectsRef.current = frame; paintRef.current(frame);
      if (elapsed < 1) frameId = requestAnimationFrame(render); else canvas.dataset.animationState = "settled";
    };
    frameId = requestAnimationFrame(render); return () => cancelAnimationFrame(frameId);
  }, [activeRoot.path, rects]);

  const emitSelection = useCallback((nodes: readonly SpaceNode[]) => { setSelected(nodes); onSelectionChange?.(nodes); onSoundEvent?.(nodes.length ? "select" : "hover"); }, [onSelectionChange, onSoundEvent]);
  const clearInteraction = useCallback(() => { setSelected([]); onSelectionChange?.([]); setGroupOpen(false); setGroupLimit(60); setMarquee(null); setContextMenu(null); setHovered(null); setPreviewOpen(false); pointerRef.current = null; }, [onSelectionChange]);
  const startFolderScan = useCallback((node: SpaceNode) => {
    drillRef.current?.controller.abort(); const controller = new AbortController(); const generation = ++generationRef.current; drillRef.current = { controller, generation };
    setLocalProgress({ phase: "scanning", scanned: 0, total: null });
    const scan = client.openFolder ? client.openFolder(node, controller.signal, (next, nextProgress) => {
      if (controller.signal.aborted || generationRef.current !== generation) return; setActiveRoot(next); setLocalProgress(nextProgress);
    }) : client.scan(node.path, controller.signal, (next, nextProgress) => {
      if (controller.signal.aborted || generationRef.current !== generation) return; setActiveRoot(next); setLocalProgress(nextProgress);
    });
    void scan.then((next) => {
      if (controller.signal.aborted || generationRef.current !== generation) return; setActiveRoot(next); setLocalProgress((previous) => ({ ...previous, phase: "complete", scanned: previous?.scanned ?? 0, total: previous?.total ?? null }));
    }).catch((error: unknown) => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setLocalProgress({ phase: "error", scanned: 0, total: null, message: error instanceof Error ? error.message : String(error) });
    }).finally(() => { if (drillRef.current?.generation === generation) drillRef.current = null; });
  }, [client]);
  const restoreRoot = useCallback((previousRoot: SpaceNode) => {
    historyProgressRef.current.set(activeRoot.path, activeProgress ?? { phase: "complete", scanned: activeRoot.children?.length ?? 0, total: null });
    onCancelScan?.();
    generationRef.current += 1; drillRef.current?.controller.abort(); drillRef.current = null;
    setActiveRoot(previousRoot); clearInteraction();
    setLocalProgress(historyProgressRef.current.get(previousRoot.path) ?? { phase: previousRoot.scanning ? "idle" : "complete", scanned: previousRoot.children?.length ?? 0, total: null });
    if (previousRoot.scanning) startFolderScan(previousRoot);
    onSoundEvent?.("open"); viewportRef.current?.focus();
  }, [activeProgress, activeRoot, clearInteraction, onCancelScan, onSoundEvent, startFolderScan]);
  const restoreHistory = useCallback((index: number) => {
    const previousRoot = rootHistory[index]; if (!previousRoot) return;
    setForwardHistory((history) => [...rootHistory.slice(index + 1), activeRoot, ...history]);
    setRootHistory((history) => history.slice(0, index));
    restoreRoot(previousRoot);
  }, [activeRoot, restoreRoot, rootHistory]);
  const forward = useCallback(() => {
    const next = forwardHistory[0]; if (!next) return;
    setRootHistory((history) => [...history, activeRoot]);
    setForwardHistory((history) => history.slice(1));
    restoreRoot(next);
  }, [activeRoot, forwardHistory, restoreRoot]);
  const openFolder = useCallback((node: SpaceNode) => {
    if (node.kind !== "folder") return;
    historyProgressRef.current.set(activeRoot.path, activeProgress ?? { phase: "complete", scanned: activeRoot.children?.length ?? 0, total: null });
    onCancelScan?.(); onSoundEvent?.("open"); onOpenFolder?.(node); setRootHistory((history) => [...history, activeRoot]); setForwardHistory([]);
    setActiveRoot(node); clearInteraction(); startFolderScan(node); viewportRef.current?.focus();
  }, [activeProgress, activeRoot, clearInteraction, onCancelScan, onOpenFolder, onSoundEvent, startFolderScan]);
  const up = useCallback(() => {
    const parent = spaceParentPath(activeRoot.path); if (!parent) return;
    const cached = [...rootHistory].reverse().find((node) => breadcrumbKey(node.path) === breadcrumbKey(parent));
    if (cached && !cached.scanning) {
      setRootHistory((history) => [...history, activeRoot]); setForwardHistory([]); restoreRoot(cached);
    } else openFolder(cached ?? { id: parent, path: parent, name: pathParts(parent).at(-1) ?? parent, kind: "folder", scanning: true });
  }, [activeRoot, openFolder, restoreRoot, rootHistory]);
  const navigateActive = useCallback((path: string) => {
    const nextPath = path.trim();
    if (!nextPath || breadcrumbKey(nextPath) === breadcrumbKey(activeRoot.path)) return;
    const cached = [...rootHistory].reverse().find((node) => breadcrumbKey(node.path) === breadcrumbKey(nextPath));
    if (cached && !cached.scanning) {
      setRootHistory((history) => [...history, activeRoot]); setForwardHistory([]); restoreRoot(cached);
    } else openFolder(cached ?? { id: nextPath, path: nextPath, name: pathParts(nextPath).at(-1) ?? nextPath, kind: "folder", scanning: true });
  }, [activeRoot, openFolder, restoreRoot, rootHistory]);
  const togglePreview = useCallback(() => {
    if (contextMenu || selected.length !== 1) return;
    setPreviewOpen((open) => !open);
  }, [contextMenu, selected.length]);
  useImperativeHandle(ref, () => ({
    up: () => { if (!contextMenu) up(); },
    back: () => { if (!contextMenu) restoreHistory(rootHistory.length - 1); },
    forward: () => { if (!contextMenu) forward(); },
    navigateActive,
    togglePreview,
  }), [contextMenu, forward, navigateActive, restoreHistory, rootHistory.length, togglePreview, up]);
  const canUp = spaceParentPath(activeRoot.path) !== null;
  useLayoutEffect(() => {
    onNavigationChange?.({ path: activeRoot.path, canBack: rootHistory.length > 0, canForward: forwardHistory.length > 0, canUp });
  }, [activeRoot.path, canUp, forwardHistory.length, onNavigationChange, rootHistory.length]);
  const stopScan = () => {
    generationRef.current += 1; drillRef.current?.controller.abort(); drillRef.current = null; onCancelScan?.();
    setLocalProgress({ ...activeProgress, phase: "idle", scanned: activeProgress?.scanned ?? 0, total: activeProgress?.total ?? null });
  };
  const localPoint = (event: { currentTarget: HTMLDivElement; clientX: number; clientY: number }): Point => { const bounds = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; };
  const hitTest = (point: Point) => displayedRectsRef.current.find((rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
  const runContextAction = useCallback((action: SpaceContextAction, node: SpaceNode | null = contextMenu?.node ?? null) => {
    setContextMenu(null);
    onContextAction?.(action, node, selected);
  }, [contextMenu?.node, onContextAction, selected]);
  useEffect(() => {
    const viewport = viewportRef.current; if (!viewport) return;
    return registerTargetCursorSurface(viewport, (clientX, clientY) => {
      const bounds = viewport.getBoundingClientRect(); const rect = hitTest({ x: clientX - bounds.left, y: clientY - bounds.top });
      return rect ? { id: rect.node.id, rect: new DOMRect(bounds.left + rect.x, bounds.top + rect.y, rect.width, rect.height) } : null;
    });
  }, [rects]);
  const moveKeyboardSelection = (key: string) => {
    const current = currentSelection[0];
    // Aggregated "Other items" is a real visible tile and must remain
    // reachable by arrows when all individual entries are too small.
    const candidates = displayedRectsRef.current.filter((rect) => rect.width > 1e-6 && rect.height > 1e-6);
    if (!candidates.length) return;
    const direction: SpaceDirection = key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowUp" ? "up" : "down";
    if (!current) { emitSelection(candidates[0]!.members ?? [candidates[0]!.node]); return; }
    const nextRect = findDirectionalSpaceRect(displayedRectsRef.current, current, direction);
    // At the edge of the map an arrow key keeps the current selection. It
    // must not wrap to the first tile, which feels like an inaccurate jump.
    if (!nextRect) return;
    emitSelection(nextRect.members ?? [nextRect.node]);
  };
  const activateNode = (node: SpaceNode) => {
    if (node.kind === "folder") openFolder(node);
    else onContextAction?.("open", node);
  };
  const showContextMenu = (event: ReactMouseEvent, node: SpaceNode) => {
    event.preventDefault(); event.stopPropagation();
    emitSelection([node]);
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 0) return; const point = localPoint(event); pointerRef.current = { start: point, current: point, dragging: false }; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = localPoint(event); const pointer = pointerRef.current;
    if (!pointer) { const id = hitTest(point)?.node.id ?? null; if (id !== hovered) { setHovered(id); if (id) onSoundEvent?.("hover"); } return; }
    pointer.current = point; pointer.dragging = Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 4;
    if (pointer.dragging) setMarquee({ start: pointer.start, current: point });
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current; if (!pointer) return; const point = localPoint(event);
    if (pointer.dragging) {
      const x = Math.min(pointer.start.x, point.x); const y = Math.min(pointer.start.y, point.y); const right = Math.max(pointer.start.x, point.x); const bottom = Math.max(pointer.start.y, point.y);
      emitSelection(displayedRectsRef.current.filter((rect) => rect.x < right && rect.x + rect.width > x && rect.y < bottom && rect.y + rect.height > y).flatMap((rect) => rect.members ?? [rect.node])); setGroupOpen(false);
    } else { const rect = hitTest(point); emitSelection(rect ? rect.members ?? [rect.node] : []); setGroupOpen(Boolean(rect?.members)); }
    setMarquee(null); pointerRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => { const rect = hitTest(localPoint(event)); if (rect && !rect.members) openFolder(rect.node); };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isImeCompositionEvent(event.nativeEvent) || contextMenu) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); moveKeyboardSelection(event.key); return; }
    if (event.key === "Escape" && previewOpen) { event.preventDefault(); setPreviewOpen(false); }
    else if (event.key === "Escape" && rootHistory.length) { event.preventDefault(); restoreHistory(rootHistory.length - 1); }
    else if (event.key === "Enter" && currentSelection.length === 1 && currentSelection[0]?.kind === "folder") { event.preventDefault(); openFolder(currentSelection[0]); }
  };
  const crumbs = pathParts(activeRoot.path); const selectedBytes = currentSelection.reduce((sum, node) => sum + spaceNodeBytes(node), 0); const single = currentSelection.length === 1 ? currentSelection[0] : undefined;
  const previewEntry: DirectoryEntry | null = single ? {
    path: single.path, name: single.name, kind: single.kind === "folder" ? "directory" : "file",
    size: spaceNodeBytes(single), extension: single.extension ?? (single.kind === "file" ? single.name.split(".").slice(1).at(-1) ?? null : null),
    modifiedUnixMs: single.modifiedAt ?? null, hidden: false,
  } : null;
  const statusText = scanning ? words.scanning : activeProgress?.phase === "error" ? words.failed : activeProgress?.phase === "idle" ? words.stopped : words.complete;
  return (
    <section className={`space-sniffer${className ? ` ${className}` : ""}`} aria-label="Space Sniffer" data-root-path={activeRoot.path} onKeyDown={(event) => {
      if (!previewOpen || contextMenu || event.key !== "Escape" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isImeCompositionEvent(event.nativeEvent)) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]')) return;
      event.preventDefault(); event.stopPropagation(); setPreviewOpen(false); viewportRef.current?.focus();
    }}>
      <header className="space-sniffer__toolbar">
        <div className="space-sniffer__heading"><span className="space-sniffer__title">{words.title}</span><span className="space-sniffer__status">{formatSpaceBytes(total)} {words.scanned} · {formatNumber(activeRoot.children?.length ?? activeRoot.childCount ?? 0)} {words.items}</span></div>
        <div className="space-sniffer__scan"><span className={`space-sniffer__scan-state${scanning ? " is-scanning" : ""}${activeProgress?.phase === "error" ? " is-error" : ""}`} role="status"><i />{statusText}</span>{scanning ? <button type="button" className="space-sniffer__button" onClick={stopScan}>{words.stop}</button> : null}</div>
        {showBreadcrumbs ? <nav className="space-sniffer__crumbs" aria-label="Folder path">
          {crumbs.map((crumb, index) => { const historyIndex = historyIndexes.get(crumbs.slice(0, index + 1).join("\\").toLowerCase()); const isCurrent = index === crumbs.length - 1;
            return <span key={`${crumb}-${index}`}>{!isCurrent && historyIndex !== undefined ? <button className="space-sniffer__crumb" type="button" onClick={() => restoreHistory(historyIndex)}>{crumb}</button> : <span className={`space-sniffer__crumb${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "page" : undefined}>{crumb}</span>}{index < crumbs.length - 1 ? <span className="space-sniffer__crumb-separator">/</span> : null}</span>; })}
        </nav> : null}
      </header>
      {activeProgress?.message ? <div className="space-sniffer__notice" role="alert">{activeProgress.message}</div> : null}
      <div ref={bodyRef} className="space-sniffer__body" style={{ "--space-details-width": `${detailsWidth}px` } as CSSProperties}>
        <div className="space-sniffer__map">
          <div className="space-sniffer__legend"><span>{words.legend}</span><span>{words.seams}</span>{activeRoot.partial ? <span>{words.partial}</span> : null}</div>
          <div ref={viewportRef} className="space-sniffer__viewport" onContextMenu={(event) => { event.preventDefault(); const rect = hitTest(localPoint(event)); const node = rect?.members?.[0] ?? rect?.node ?? null; if (node) emitSelection([node]); setContextMenu({ x: event.clientX, y: event.clientY, node }); }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => { pointerRef.current = null; setMarquee(null); }} onPointerLeave={() => setHovered(null)} onDoubleClick={handleDoubleClick} onKeyDown={handleKeyDown} role="application" aria-label="Folder space map" tabIndex={0}>
            <canvas ref={canvasRef} className="space-sniffer__canvas" aria-hidden="true" data-visible-count={rects.length} data-area-bytes={total} />
            {!rects.length ? <div className="space-sniffer__awaiting">{scanning ? <span className="space-sniffer__discovery" /> : null}<span>{scanning ? words.noBytes : words.zero}</span></div> : null}
            {marquee ? <div className="space-sniffer__marquee" style={{ left: Math.min(marquee.start.x, marquee.current.x), top: Math.min(marquee.start.y, marquee.current.y), width: Math.abs(marquee.current.x - marquee.start.x), height: Math.abs(marquee.current.y - marquee.start.y) }} /> : null}
          </div>
          {contextMenu ? <div className="space-sniffer__context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            {contextMenu.node ? <>
              <button type="button" role="menuitem" onClick={() => { if (contextMenu.node?.kind === "folder") { setContextMenu(null); openFolder(contextMenu.node); } else runContextAction("open"); }}>{words.open}</button>
              {contextMenu.node.kind === "file" ? <button type="button" role="menuitem" onClick={() => runContextAction("open-with")}>{words.openWith}</button> : null}
              {contextMenu.node.kind === "folder" ? <button type="button" role="menuitem" onClick={() => runContextAction("custom-organize")}>{words.organize}</button> : null}
              <button type="button" role="menuitem" onClick={() => runContextAction("locate")}>{words.locate}</button>
              <span className="menu-separator" />
              <button type="button" role="menuitem" onClick={() => runContextAction("copy")}>{words.copy}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("cut")}>{words.cut}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("copy-name")}>{words.copyName}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("copy-path")}>{words.copyPath}</button>
              <span className="menu-separator" />
              <button type="button" role="menuitem" onClick={() => runContextAction("open-terminal")}>{words.terminal}</button>
              {contextMenu.node.kind === "file" && contextMenu.node.extension?.toLowerCase() === "zip" ? <>
                <button type="button" role="menuitem" onClick={() => runContextAction("extract-current")}>{words.extractCurrent}</button>
                <button type="button" role="menuitem" onClick={() => runContextAction("extract-named")}>{words.extractNamed}</button>
                <button type="button" role="menuitem" onClick={() => runContextAction("extract-choose")}>{words.extractChoose}</button>
              </> : null}
              <button type="button" role="menuitem" onClick={() => runContextAction("compress-zip")}>{words.compress}</button>
              <span className="menu-separator" />
              <button type="button" role="menuitem" onClick={() => runContextAction("rename")}>{words.rename}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("recycle")}>{words.recycle}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("properties")}>{words.properties}</button>
            </> : <>
              <button type="button" role="menuitem" onClick={() => runContextAction("new-folder")}>{words.newFolder}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("new-text-document")}>{words.newText}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("new-empty-file")}>{words.newEmpty}</button>
              <span className="menu-separator" />
              <button type="button" role="menuitem" onClick={() => runContextAction("paste")}>{words.paste}</button>
              <button type="button" role="menuitem" onClick={() => runContextAction("refresh")}>{words.refresh}</button>
            </>}
          </div> : null}
          <footer className="space-sniffer__map-footer">{grouped.length ? <button type="button" className="space-sniffer__group-toggle" onClick={() => { setGroupOpen(!groupOpen); if (!groupOpen) emitSelection(grouped); }}>{words.other} · {formatNumber(grouped.length)} <span>{formatSpaceBytes(grouped.reduce((sum, node) => sum + spaceNodeBytes(node), 0))}</span></button> : <span>{formatNumber(activeProgress?.scanned ?? activeRoot.children?.length ?? 0)} {words.items}</span>}<span className="space-sniffer__hint">{words.hint}</span></footer>
        </div>
        <div className="space-sniffer__resize-handle" role="separator" aria-orientation="vertical" aria-label="调整详情栏宽度" tabIndex={0}
          onPointerDown={(event) => { event.preventDefault(); resizeRef.current = { startX: event.clientX, startWidth: detailsWidth }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
          onKeyDown={(event) => { if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return; event.preventDefault(); setDetailsWidth((value) => Math.max(180, Math.min(460, value + (event.key === "ArrowLeft" ? 16 : -16)))); }}
          onDoubleClick={() => setDetailsWidth(248)} />
        <aside className="space-sniffer__details" aria-label={words.selected}>
          <div className="space-sniffer__details-label">{words.selected}</div>
          {currentSelection.length ? <><div className="space-sniffer__selection-card"><h2>{single?.name ?? (groupOpen ? words.other : `${formatNumber(currentSelection.length)} ${words.items}`)}</h2><span>{single ? single.kind === "folder" ? words.folder : words.file : `${formatNumber(currentSelection.length)} ${words.items}`}{single?.partial ? ` · ${words.partial}` : ""}</span></div>
            <div className="space-sniffer__selection-actions">
            {single?.kind === "folder" ? <button type="button" className="space-sniffer__open" onClick={() => openFolder(single)}>{words.open}<span>↗</span></button> : null}
            {single ? <button type="button" className="space-sniffer__open space-sniffer__preview-button" aria-pressed={previewOpen} title={t("previewShortcut")} onClick={togglePreview}>{t("preview")}<span>Space</span></button> : null}
            </div>
            {!previewOpen || !single ? <dl className="space-sniffer__metrics"><dt>{words.size}</dt><dd className="space-sniffer__metric">{formatSpaceBytes(selectedBytes)}</dd><dt>{words.share}</dt><dd>{total > 0 ? (selectedBytes / total * 100).toFixed(1) : "0.0"}%</dd>{single?.kind === "folder" ? <><dt>{words.contents}</dt><dd>{formatNumber(single.children?.length ?? single.childCount ?? 0)} {words.items}</dd></> : null}{single ? <><dt>{words.path}</dt><dd className="space-sniffer__path" title={single.path}>{single.path}</dd></> : null}</dl> : null}
          </> : <div className="space-sniffer__empty"><span className="space-sniffer__empty-icon" /><p>{words.empty}</p></div>}
          {previewOpen && previewEntry ? <PreviewPanel variant="embedded" entry={previewEntry} pinned={false} mediaAutoplay={mediaAutoplay} onPinnedChange={() => undefined} onMediaAutoplayChange={(enabled) => onMediaAutoplayChange?.(enabled)} onClose={() => { setPreviewOpen(false); viewportRef.current?.focus(); }} /> : null}
          {groupOpen ? <div className="space-sniffer__group-list"><p>{words.otherHint}</p>{grouped.slice(0, groupLimit).map((node) => <button key={node.id} type="button" title={node.path} className={selectedIds.has(node.id) ? "is-selected" : undefined} aria-pressed={selectedIds.has(node.id)} onClick={() => emitSelection([node])} onDoubleClick={() => activateNode(node)} onContextMenu={(event) => showContextMenu(event, node)} onKeyDown={(event) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || contextMenu || isImeCompositionEvent(event.nativeEvent)) return;
            if (event.key === " ") {
              event.preventDefault(); event.stopPropagation();
              setPreviewOpen((open) => currentSelection.length === 1 && currentSelection[0]?.id === node.id ? !open : true);
              emitSelection([node]);
            } else if (event.key === "Enter") { event.preventDefault(); activateNode(node); }
          }}><span>{node.name}</span><small>{formatSpaceBytes(spaceNodeBytes(node))}</small></button>)}{grouped.length > groupLimit ? <button type="button" onClick={() => setGroupLimit((value) => value + 60)}>{words.more} · {groupLimit} {words.of} {grouped.length}</button> : null}</div> : null}
          <div className="space-sniffer__keyboard">{locale === "zh-CN" ? "Enter 打开 · Space 预览 · Backspace 上一级 · Alt ←/→ 后退/前进" : "Enter to open · Space to preview · Backspace up · Alt ←/→ back/forward"}</div>
        </aside>
      </div>
    </section>
  );
}

export type { SpaceNode, SpaceSnifferClient, SpaceSnifferProps } from "./types";
