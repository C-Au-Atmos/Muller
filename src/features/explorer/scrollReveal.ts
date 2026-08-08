export type ScrollAxis = "x" | "y";

export function revealScrollTarget(
  current: number,
  viewportSize: number,
  itemStart: number,
  itemEnd: number,
  contentSize: number,
  margin = 12,
): number {
  const visibleStart = current + margin;
  const visibleEnd = current + viewportSize - margin;
  let target = current;
  if (itemStart < visibleStart) target = itemStart - margin;
  else if (itemEnd > visibleEnd) target = itemEnd - viewportSize + margin;
  return Math.min(Math.max(target, 0), Math.max(0, contentSize - viewportSize));
}

export interface RetargetableScrollController {
  reveal: (axis: ScrollAxis, target: number, reducedMotion: boolean) => void;
  cancel: () => void;
}

export function createRetargetableScrollController(
  element: HTMLElement,
): RetargetableScrollController {
  let frame: number | null = null;
  let axis: ScrollAxis = "y";
  let target = 0;
  let velocity = 0;
  let previousAt = performance.now();

  const position = () => axis === "x" ? element.scrollLeft : element.scrollTop;
  const write = (value: number) => {
    if (axis === "x") element.scrollLeft = value;
    else element.scrollTop = value;
  };
  const cancel = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    velocity = 0;
  };
  const tick = (now: number) => {
    const elapsed = Math.min(Math.max((now - previousAt) / 1000, 1 / 240), 1 / 20);
    previousAt = now;
    const current = position();
    const acceleration = (target - current) * 190 - velocity * 27;
    velocity += acceleration * elapsed;
    const next = current + velocity * elapsed;
    if (Math.abs(target - next) < 0.35 && Math.abs(velocity) < 5) {
      write(target);
      cancel();
      return;
    }
    write(next);
    frame = window.requestAnimationFrame(tick);
  };

  return {
    reveal(nextAxis, nextTarget, reducedMotion) {
      if (axis !== nextAxis) velocity = 0;
      axis = nextAxis;
      target = nextTarget;
      if (reducedMotion) {
        cancel();
        write(target);
        return;
      }
      previousAt = performance.now();
      if (frame === null) frame = window.requestAnimationFrame(tick);
    },
    cancel,
  };
}

