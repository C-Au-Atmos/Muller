import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { SelectionModifiers } from "./selectionModel";

export interface MarqueeRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface MarqueeOptions {
  viewportRef: RefObject<HTMLElement | null>;
  axis: "vertical" | "horizontal";
  hitTest: (rectangle: MarqueeRectangle) => ReadonlySet<number>;
  onStart: (modifiers: SelectionModifiers) => void;
  onChange: (positions: ReadonlySet<number>) => void;
  onBlankClick: (modifiers: SelectionModifiers) => void;
  onEnd?: () => void;
  allowFromItems?: boolean;
  itemSelector?: string;
  blockSelector?: string;
}

const DRAG_THRESHOLD = 3;
const EDGE_SIZE = 44;
const MAX_EDGE_STEP = 18;

function modifiersFromEvent(event: ReactPointerEvent<HTMLElement>): SelectionModifiers {
  return {
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
  };
}

export function useMarqueeSelection({
  viewportRef,
  axis,
  hitTest,
  onStart,
  onChange,
  onBlankClick,
  onEnd,
  allowFromItems = false,
  itemSelector = '[data-selection-item="true"]',
  blockSelector = '[data-selection-item="true"]',
}: MarqueeOptions) {
  const [rectangle, setRectangle] = useState<MarqueeRectangle | null>(null);
  const pointerRef = useRef<{
    id: number;
    startClient: Point;
    startContent: Point;
    latestClient: Point;
    modifiers: SelectionModifiers;
    dragging: boolean;
    startedOnItem: boolean;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const contentPoint = useCallback((client: Point): Point | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const bounds = viewport.getBoundingClientRect();
    return {
      x: client.x - bounds.left + viewport.scrollLeft,
      y: client.y - bounds.top + viewport.scrollTop,
    };
  }, [viewportRef]);

  const update = useCallback(() => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    const current = contentPoint(pointer.latestClient);
    if (!current) return;
    const next = {
      x: Math.min(pointer.startContent.x, current.x),
      y: Math.min(pointer.startContent.y, current.y),
      width: Math.abs(current.x - pointer.startContent.x),
      height: Math.abs(current.y - pointer.startContent.y),
    };
    setRectangle(next);
    onChange(hitTest(next));
  }, [contentPoint, hitTest, onChange]);

  const stopAutoScroll = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const autoScroll = useCallback(() => {
    const viewport = viewportRef.current;
    const pointer = pointerRef.current;
    if (!viewport || !pointer || !pointer.dragging) {
      frameRef.current = null;
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const coordinate = axis === "horizontal" ? pointer.latestClient.x : pointer.latestClient.y;
    const start = axis === "horizontal" ? bounds.left : bounds.top;
    const end = axis === "horizontal" ? bounds.right : bounds.bottom;
    let step = 0;
    if (coordinate < start + EDGE_SIZE) {
      step = -MAX_EDGE_STEP * Math.min(1, (start + EDGE_SIZE - coordinate) / EDGE_SIZE);
    } else if (coordinate > end - EDGE_SIZE) {
      step = MAX_EDGE_STEP * Math.min(1, (coordinate - (end - EDGE_SIZE)) / EDGE_SIZE);
    }
    if (step !== 0) {
      const previous = axis === "horizontal" ? viewport.scrollLeft : viewport.scrollTop;
      if (axis === "horizontal") viewport.scrollLeft += step;
      else viewport.scrollTop += step;
      const current = axis === "horizontal" ? viewport.scrollLeft : viewport.scrollTop;
      if (current !== previous) update();
    }
    frameRef.current = window.requestAnimationFrame(autoScroll);
  }, [axis, update, viewportRef]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const startedOnItem = Boolean(
      (event.target as Element).closest(itemSelector),
    );
    const blocked = Boolean((event.target as Element).closest(blockSelector));
    if (event.button !== 0 || (blocked && !allowFromItems)) return;
    const startClient = { x: event.clientX, y: event.clientY };
    const startContent = contentPoint(startClient);
    if (!startContent) return;
    const modifiers = modifiersFromEvent(event);
    pointerRef.current = {
      id: event.pointerId,
      startClient,
      startContent,
      latestClient: startClient,
      modifiers,
      dragging: false,
      startedOnItem,
    };
    onStart(modifiers);
  }, [allowFromItems, blockSelector, contentPoint, itemSelector, onStart]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer.latestClient = { x: event.clientX, y: event.clientY };
    if (!pointer.dragging) {
      const distance = Math.hypot(
        event.clientX - pointer.startClient.x,
        event.clientY - pointer.startClient.y,
      );
      if (distance < DRAG_THRESHOLD) return;
      event.preventDefault();
      pointer.dragging = true;
      suppressClickRef.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      frameRef.current ??= window.requestAnimationFrame(autoScroll);
    }
    update();
  }, [autoScroll, update]);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.dragging && !pointer.startedOnItem) onBlankClick(pointer.modifiers);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
    setRectangle(null);
    stopAutoScroll();
    onEnd?.();
    if (pointer.dragging) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }, [onBlankClick, onEnd, stopAutoScroll]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return {
    rectangle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: finish,
    handlePointerCancel: finish,
    shouldSuppressClick: () => suppressClickRef.current,
  };
}
