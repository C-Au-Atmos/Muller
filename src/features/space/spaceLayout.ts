import type { SpaceNode } from "./types";

export interface SpaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  node: SpaceNode;
  members?: readonly SpaceNode[];
}

export type SpaceDirection = "left" | "right" | "up" | "down";

/**
 * Pick the next visible tile in a direction from the current tile.
 *
 * Space maps are not a grid: a tile can be much wider or taller than its
 * neighbours and the squarified rows change orientation as they recurse. A
 * centre-point/Euclidean sort therefore makes an arrow key jump diagonally to
 * a small tile. Navigation first keeps candidates whose perpendicular
 * projection overlaps the source (the same visual row/column), then measures
 * the edge distance in the requested direction. Candidates outside that beam
 * use the sum of the forward and perpendicular distances as a deterministic
 * fallback. `source` may be a grouped member; in that case its aggregate
 * rectangle is used as the origin.
 */
export function findDirectionalSpaceRect(
  rects: readonly SpaceRect[],
  source: SpaceNode | undefined,
  direction: SpaceDirection,
): SpaceRect | undefined {
  if (!source || !rects.length) return undefined;
  const sourceRect = rects.find((rect) => rect.node.id === source.id || rect.members?.some((member) => member.id === source.id));
  if (!sourceRect) return undefined;

  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const sourceStart = horizontal ? sourceRect.x : sourceRect.y;
  const sourceEnd = horizontal ? sourceRect.x + sourceRect.width : sourceRect.y + sourceRect.height;
  const sourcePerpStart = horizontal ? sourceRect.y : sourceRect.x;
  const sourcePerpEnd = horizontal ? sourceRect.y + sourceRect.height : sourceRect.x + sourceRect.width;
  const sourceCenter = (sourceStart + sourceEnd) / 2;
  const sourcePerpCenter = (sourcePerpStart + sourcePerpEnd) / 2;

  const candidates = rects.flatMap((rect) => {
    if (rect === sourceRect || rect.node.id === source.id || rect.members?.some((member) => member.id === source.id)) return [];
    if (rect.width <= 1e-6 || rect.height <= 1e-6) return [];
    const start = horizontal ? rect.x : rect.y;
    const end = horizontal ? rect.x + rect.width : rect.y + rect.height;
    const perpStart = horizontal ? rect.y : rect.x;
    const perpEnd = horizontal ? rect.y + rect.height : rect.x + rect.width;
    const center = (start + end) / 2;
    const forwardDistance = (center - sourceCenter) * sign;
    // A tile whose centre is exactly aligned with the source is not in a
    // direction. This also avoids selecting the source again during an
    // in-flight layout interpolation when two centres briefly coincide.
    if (forwardDistance <= 1e-6) return [];
    const overlap = Math.max(0, Math.min(sourcePerpEnd, perpEnd) - Math.max(sourcePerpStart, perpStart));
    const perpendicularGap = Math.max(0, Math.max(sourcePerpStart, perpStart) - Math.min(sourcePerpEnd, perpEnd));
    const edgeDistance = sign > 0 ? Math.max(0, start - sourceEnd) : Math.max(0, sourceStart - end);
    return [{ rect, aligned: overlap > 1e-6, edgeDistance, perpendicularGap, forwardDistance, perpendicularCenterDistance: Math.abs((perpStart + perpEnd) / 2 - sourcePerpCenter) }];
  });
  candidates.sort((a, b) => {
    if (a.aligned !== b.aligned) return a.aligned ? -1 : 1;
    if (a.aligned) {
      return a.edgeDistance - b.edgeDistance || a.perpendicularCenterDistance - b.perpendicularCenterDistance || a.forwardDistance - b.forwardDistance || a.rect.node.id.localeCompare(b.rect.node.id);
    }
    return (a.forwardDistance + a.perpendicularGap) - (b.forwardDistance + b.perpendicularGap) || a.forwardDistance - b.forwardDistance || a.perpendicularGap - b.perpendicularGap || a.rect.node.id.localeCompare(b.rect.node.id);
  });
  return candidates[0]?.rect;
}

export const spaceNodeBytes = (node: SpaceNode): number => {
  const value = node.bytes ?? node.size ?? 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** Squarify against the remaining viewport's short edge. Sorting is O(n log n),
 * and each item is considered and placed at most twice after sorting. */
export function layoutNodes(nodes: readonly SpaceNode[], width: number, height: number): SpaceRect[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const items = nodes.map((node) => ({ node, bytes: spaceNodeBytes(node) }))
    .filter((item) => item.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0));
  const total = items.reduce((sum, item) => sum + item.bytes, 0);
  if (!total || !Number.isFinite(total)) return [];
  const scale = width * height / total;
  const rects: SpaceRect[] = [];
  let x = 0; let y = 0; let remainingWidth = width; let remainingHeight = height;
  let offset = 0;
  while (offset < items.length) {
    const shortEdge = Math.min(remainingWidth, remainingHeight);
    if (shortEdge <= 0) break;
    const start = offset;
    let rowArea = items[offset]!.bytes * scale;
    const maxArea = rowArea;
    const worst = (sum: number, min: number) => Math.max(shortEdge * shortEdge * maxArea / (sum * sum), sum * sum / (shortEdge * shortEdge * min));
    let aspect = worst(rowArea, rowArea);
    offset += 1;
    while (offset < items.length) {
      const area = items[offset]!.bytes * scale;
      const nextAspect = worst(rowArea + area, area);
      if (nextAspect > aspect) break;
      rowArea += area; aspect = nextAspect; offset += 1;
    }
    const vertical = remainingWidth >= remainingHeight;
    const thickness = Math.min(rowArea / shortEdge, vertical ? remainingWidth : remainingHeight);
    let cursor = vertical ? y : x;
    for (let index = start; index < offset; index += 1) {
      const item = items[index]!;
      const length = index === offset - 1
        ? (vertical ? y + remainingHeight : x + remainingWidth) - cursor
        : item.bytes * scale / thickness;
      rects.push({ node: item.node, x: vertical ? x : cursor, y: vertical ? cursor : y,
        width: vertical ? thickness : length, height: vertical ? length : thickness });
      cursor += length;
    }
    if (vertical) { x += thickness; remainingWidth = Math.max(0, width - x); }
    else { y += thickness; remainingHeight = Math.max(0, height - y); }
  }
  return rects;
}

/** Tiny entries retain their exact combined area. A separate list makes even
 * a subpixel aggregate and zero-byte entries accessible without inflating it. */
export function buildSpaceMapLayout(nodes: readonly SpaceNode[], width: number, height: number, rootId: string) {
  const first = layoutNodes(nodes, width, height);
  let visible: SpaceNode[] = [];
  const grouped: SpaceNode[] = [];
  for (const rect of first) {
    if (visible.length < 319 && rect.width * rect.height >= 1600 && Math.min(rect.width, rect.height) >= 28) visible.push(rect.node);
    else grouped.push(rect.node);
  }
  for (const node of nodes) if (spaceNodeBytes(node) === 0) grouped.push(node);
  if (!grouped.length) return { rects: first, grouped };
  const aggregate: SpaceNode = { id: `\u0000space-other:${rootId}`, name: "Other items", path: "", kind: "file",
    bytes: grouped.reduce((sum, node) => sum + spaceNodeBytes(node), 0) };
  // Repacking can make a formerly usable node narrow. Each pass removes at
  // least one of at most 319 candidates, so this refinement is bounded.
  for (;;) {
    aggregate.bytes = grouped.reduce((sum, node) => sum + spaceNodeBytes(node), 0);
    const next = layoutNodes([...visible, aggregate], width, height);
    const tooSmall = next.filter((rect) => rect.node !== aggregate && (Math.min(rect.width, rect.height) < 28 || rect.width * rect.height < 1600));
    if (!tooSmall.length) return { rects: next.map((rect) => rect.node === aggregate ? { ...rect, members: grouped } : rect), grouped };
    const removed = new Set(tooSmall.map((rect) => rect.node.id));
    grouped.push(...tooSmall.map((rect) => rect.node));
    visible = visible.filter((node) => !removed.has(node.id));
  }
}

/** Stable IDs preserve a block's current position when new scan bytes arrive. */
export function interpolateSpaceRects(previous: ReadonlyMap<string, SpaceRect>, target: readonly SpaceRect[], progress: number): SpaceRect[] {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 1) return [...target];
  return target.map((rect) => {
    const from = previous.get(rect.node.id) ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: 0, height: 0 };
    return { ...rect, x: from.x + (rect.x - from.x) * t, y: from.y + (rect.y - from.y) * t,
      width: from.width + (rect.width - from.width) * t, height: from.height + (rect.height - from.height) * t };
  });
}
