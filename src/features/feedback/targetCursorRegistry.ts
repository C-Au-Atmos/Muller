export interface TargetCursorHit {
  id: string;
  rect: DOMRect | { left: number; top: number; width: number; height: number };
}

type Resolver = (clientX: number, clientY: number) => TargetCursorHit | null;
const surfaces = new Map<HTMLElement, Resolver>();

export function registerTargetCursorSurface(element: HTMLElement, resolver: Resolver): () => void {
  surfaces.set(element, resolver);
  return () => surfaces.delete(element);
}

export function resolveTargetCursorSurface(clientX: number, clientY: number): TargetCursorHit | null {
  for (const [element, resolver] of surfaces) {
    if (!element.isConnected) { surfaces.delete(element); continue; }
    const bounds = element.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) continue;
    const hit = resolver(clientX, clientY);
    if (hit) return hit;
  }
  return null;
}
