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
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || window.matchMedia("(pointer: coarse)").matches) return;
    const move = (event: MouseEvent) => {
      if (frame.current === null) frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const surfaceHit = resolveTargetCursorSurface(event.clientX, event.clientY);
        // Target Cursor is intentionally limited to the Space Sniffer surface.
        // It should never decorate unrelated shell controls or settings.
        setHit(surfaceHit);
        setVisible(Boolean(surfaceHit));
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
  if (!bounds) return null;
  const style = { left: bounds.left - 5, top: bounds.top - 5, width: bounds.width + 10, height: bounds.height + 10 };
  return createPortal(<div aria-hidden="true" className={`target-cursor${visible ? " is-visible" : ""}${hit ? " is-locked" : ""}${reducedMotion ? " is-reduced" : ""}`} style={style}><i /><b /><b /><b /><b /></div>, document.body);
}
