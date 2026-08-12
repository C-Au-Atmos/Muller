import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";

import { useAppI18n } from "../../../i18n/i18n";

interface LineSidebarProps {
  items: readonly string[];
  icons?: readonly ReactNode[];
  selected: number;
  onChange: (index: number, item: string) => void;
  onTick?: () => void;
  className?: string;
}

export function LineSidebar({ items, icons, selected, onChange, onTick, className = "" }: LineSidebarProps) {
  const { t } = useAppI18n();
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const targets = useRef<number[]>([]);
  const current = useRef<number[]>([]);
  const frame = useRef<number | null>(null);
  const previous = useRef(0);
  const selectedRef = useRef(selected);

  const renderFrame = useCallback((time: number) => {
    const delta = Math.min((time - previous.current) / 1000, 0.05);
    previous.current = time;
    const factor = 1 - Math.exp(-delta / 0.1);
    let moving = false;
    itemRefs.current.forEach((item, index) => {
      if (!item) return;
      const destination = Math.max(targets.current[index] ?? 0, index === selectedRef.current ? 1 : 0);
      const value = (current.current[index] ?? 0) + (destination - (current.current[index] ?? 0)) * factor;
      current.current[index] = Math.abs(destination - value) < 0.001 ? destination : value;
      item.style.setProperty("--line-effect", current.current[index]?.toFixed(4) ?? "0");
      if (current.current[index] !== destination) moving = true;
    });
    frame.current = moving && document.visibilityState === "visible" ? requestAnimationFrame(renderFrame) : null;
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

  useEffect(() => {
    selectedRef.current = selected;
    ensureFrame();
  }, [ensureFrame, selected]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") ensureFrame();
      else stopFrame();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopFrame();
    };
  }, [ensureFrame, stopFrame]);

  const handlePointerMove = (event: PointerEvent<HTMLUListElement>) => {
    const list = listRef.current;
    if (!list) return;
    itemRefs.current.forEach((item, index) => {
      if (!item) return;
      const bounds = item.getBoundingClientRect();
      const distance = Math.abs(event.clientY - (bounds.top + bounds.height / 2));
      const raw = Math.max(0, 1 - distance / 100);
      targets.current[index] = raw * raw * (3 - 2 * raw);
    });
    ensureFrame();
  };
  const handlePointerLeave = () => {
    targets.current = items.map(() => 0);
    ensureFrame();
  };

  return (
    <nav className={`line-sidebar${className ? ` ${className}` : ""}`} aria-label={t("quickLocations")}>
      <ul ref={listRef} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <button
              ref={(element) => { itemRefs.current[index] = element; }}
              className="line-sidebar__item"
              type="button"
              aria-current={selected === index ? "page" : undefined}
              onPointerEnter={onTick}
              onClick={() => onChange(index, item)}
              style={{ "--line-effect": selected === index ? 1 : 0 } as CSSProperties}
            >
              <span className="line-sidebar__marker" aria-hidden="true" />
              <span className="line-sidebar__index">{String(index + 1).padStart(2, "0")}</span>
              {icons?.[index] ? <span className="line-sidebar__icon">{icons[index]}</span> : null}
              <span className="line-sidebar__label">{item}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
