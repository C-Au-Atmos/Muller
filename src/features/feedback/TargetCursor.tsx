import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { resolveTargetCursorSurface, type TargetCursorHit } from "./targetCursorRegistry";
import "./TargetCursor.css";

export interface TargetCursorProps {
  enabled?: boolean;
  reducedMotion?: boolean;
}

export function TargetCursor({ enabled = true, reducedMotion = false }: TargetCursorProps) {
  const [visible, setVisible] = useState(false);
  const [hit, setHit] = useState<TargetCursorHit | null>(null);
  const position = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || window.matchMedia("(pointer: coarse)").matches) return;
    const move = (event: MouseEvent) => {
      position.current = { x: event.clientX, y: event.clientY };
      if (frame.current === null) frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const target = element?.closest<HTMLElement>("button,a,[role=button],[role=menuitem],.cursor-target");
        const rect = target && !target.matches(":disabled,[aria-disabled=true]") ? target.getBoundingClientRect() : null;
        const surfaceHit = resolveTargetCursorSurface(event.clientX, event.clientY);
        setHit(surfaceHit ?? (rect ? { id: target?.dataset.cursorTarget ?? "dom-target", rect } : null));
        setVisible(true);
      });
    };
    const leave = () => { setVisible(false); setHit(null); };
    const blur = () => { setVisible(false); setHit(null); };
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mouseleave", leave);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", blur);
    return () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", blur);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [enabled]);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);
  if (!enabled || typeof document === "undefined") return null;
  const bounds = hit?.rect;
  const style = bounds ? { left: bounds.left - 4, top: bounds.top - 4, width: bounds.width + 8, height: bounds.height + 8 } : { left: position.current.x - 7, top: position.current.y - 7, width: 14, height: 14 };
  return createPortal(<div aria-hidden="true" className={`target-cursor${visible ? " is-visible" : ""}${hit ? " is-locked" : ""}${reducedMotion ? " is-reduced" : ""}`} style={style}><i /><b /><b /><b /><b /></div>, document.body);
}
