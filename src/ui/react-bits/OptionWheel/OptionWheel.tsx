import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";

import { useAppI18n } from "../../../i18n/i18n";

interface OptionWheelProps {
  items: readonly string[];
  selected: number;
  onChange: (index: number, item: string) => void;
  onTick?: () => void;
  className?: string;
  disabled?: boolean;
}

export function OptionWheel({ items, selected, onChange, onTick, className = "", disabled = false }: OptionWheelProps) {
  const { t } = useAppI18n();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const initialPosition = Math.max(selected, 0);
  const position = useRef(initialPosition);
  const target = useRef(initialPosition);
  const frame = useRef<number | null>(null);
  const previous = useRef(0);
  const drag = useRef<{ id: number; y: number; start: number; itemIndex: number | null; moved: boolean } | null>(null);
  const lastTick = useRef(Number.NEGATIVE_INFINITY);
  const [dragging, setDragging] = useState(false);

  const renderFrame = useCallback((time: number) => {
    const delta = Math.min((time - previous.current) / 1000, 0.05);
    previous.current = time;
    const factor = 1 - Math.exp(-delta / 0.2);
    const next = position.current + (target.current - position.current) * factor;
    position.current = Math.abs(target.current - next) < 0.001 ? target.current : next;
    itemRefs.current.forEach((item, index) => {
      if (!item) return;
      const distance = index - position.current;
      const absolute = Math.abs(distance);
      const angle = distance * 8;
      const radius = 310;
      const x = radius - Math.cos(angle * Math.PI / 180) * radius;
      const opacity = Math.max(0.08, 1 - absolute * 0.22);
      item.style.setProperty("--wheel-y", `${distance * 49}px`);
      item.style.setProperty("--wheel-x", `${x}px`);
      item.style.setProperty("--wheel-rotate", `${angle}deg`);
      item.style.setProperty("--wheel-opacity", opacity.toFixed(3));
      item.style.setProperty("--wheel-blur", `${Math.max(0, absolute - 0.35) * 0.85}px`);
      item.style.setProperty("--wheel-active", Math.max(0, 1 - absolute).toFixed(3));
    });
    frame.current = position.current === target.current ? null : requestAnimationFrame(renderFrame);
  }, []);

  const ensureFrame = useCallback(() => {
    if (frame.current !== null || document.visibilityState !== "visible") return;
    previous.current = performance.now();
    frame.current = requestAnimationFrame(renderFrame);
  }, [renderFrame]);

  const stopFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const preview = useCallback((next: number) => {
    if (disabled || items.length === 0) return;
    const index = Math.min(Math.max(Math.round(next), 0), items.length - 1);
    target.current = index;
    ensureFrame();
    const now = performance.now();
    if (now - lastTick.current >= 70) {
      lastTick.current = now;
      onTick?.();
    }
  }, [disabled, ensureFrame, items.length, onTick]);

  const commit = useCallback((next: number) => {
    if (disabled || items.length === 0) return;
    const index = Math.min(Math.max(Math.round(next), 0), items.length - 1);
    preview(index);
    const item = items[index];
    if (item !== undefined && index !== selected) onChange(index, item);
  }, [disabled, items, onChange, preview, selected]);

  useEffect(() => {
    target.current = selected < 0
      ? 0
      : Math.min(Math.max(selected, 0), Math.max(items.length - 1, 0));
    ensureFrame();
  }, [ensureFrame, items.length, selected]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") ensureFrame();
      else stopFrame();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    ensureFrame();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopFrame();
    };
  }, [ensureFrame, stopFrame]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      preview(target.current - 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      preview(target.current + 1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      preview(event.key === "Home" ? 0 : items.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(target.current);
    }
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    preview(target.current + Math.sign(event.deltaY));
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pressedItem = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-wheel-index]");
    drag.current = {
      id: event.pointerId,
      y: event.clientY,
      start: target.current,
      itemIndex: pressedItem ? Number(pressedItem.dataset.wheelIndex) : null,
      moved: false,
    };
    setDragging(true);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    if (Math.abs(event.clientY - drag.current.y) >= 4) drag.current.moved = true;
    target.current = Math.min(Math.max(drag.current.start + (drag.current.y - event.clientY) / 49, 0), items.length - 1);
    ensureFrame();
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const completed = drag.current;
    drag.current = null;
    setDragging(false);
    if (event.type === "pointerup" && !completed.moved && completed.itemIndex !== null) {
      commit(completed.itemIndex);
    } else {
      preview(target.current);
    }
  };

  return (
    <div
      className={`option-wheel${dragging ? " is-dragging" : ""}${className ? ` ${className}` : ""}`}
      role="listbox"
      aria-label={t("quickLocations")}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <span className="option-wheel__centerline" aria-hidden="true" />
      {items.map((item, index) => (
        <button
          ref={(element) => { itemRefs.current[index] = element; }}
          className="option-wheel__item"
          type="button"
          role="option"
          aria-selected={selected === index}
          data-wheel-index={index}
          key={`${item}-${index}`}
          onClick={() => {
            if (!dragging) commit(index);
          }}
          style={{ "--wheel-y": `${(index - Math.max(selected, 0)) * 49}px` } as CSSProperties}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
