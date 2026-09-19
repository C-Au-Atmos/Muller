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

/**
 * The space map can show a small, read-only content thumbnail for the
 * largest folders in the current directory. Keep the selection deterministic
 * so a scan update does not make the thumbnail jump between equally sized
 * folders.
 */
export function selectLargestSpaceFolders(nodes: readonly SpaceNode[], count: number): SpaceNode[] {
  const limit = Math.min(3, Math.max(1, Math.round(count) || 1));
  const largest: SpaceNode[] = [];
  for (const node of nodes) {
    const bytes = spaceNodeBytes(node);
    if (node.kind !== "folder" || !bytes) continue;
    const position = largest.findIndex((candidate) => bytes > spaceNodeBytes(candidate)
      || bytes === spaceNodeBytes(candidate) && node.id < candidate.id);
    if (position < 0) {
      if (largest.length < limit) largest.push(node);
    } else {
      largest.splice(position, 0, node);
      if (largest.length > limit) largest.pop();
    }
  }
  return largest;
}

export interface SpacePreviewRect extends SpaceRect {
  /** Depth 1 is a direct child of the previewed folder; depth 2 is its child. */
  depth: 1 | 2;
}

/**
 * Build the nested rectangles used by a thumbnail. This is intentionally
 * separate from the interactive map layout: callers can render these blocks
 * without adding them to hit testing or keyboard navigation. Each folder is
 * limited to a bounded number of visible children so a huge directory cannot
 * turn a paint into a second full treemap pass.
 */
export function buildSpacePreviewLayout(
  root: SpaceNode,
  width: number,
  height: number,
  maxDepth: 2,
  maxChildren = 24,
): SpacePreviewRect[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || maxDepth < 1) return [];
  const result: SpacePreviewRect[] = [];
  const boundedChildren = Math.max(4, Math.min(48, Math.round(maxChildren) || 24));
  const previewNodes = (parent: SpaceNode): SpaceNode[] => {
    // Retain only a small sorted candidate set. A scan batch can update a
    // folder with hundreds of thousands of children; never copy and sort its
    // whole array just to paint 24 blocks. Each source weight is read once.
    const candidates: { node: SpaceNode; bytes: number }[] = [];
    let omittedBytes = 0;
    let hasOmitted = false;
    for (const node of parent.children ?? []) {
      const bytes = spaceNodeBytes(node);
      if (!bytes) continue;
      const last = candidates[candidates.length - 1];
      if (candidates.length === boundedChildren && last
        && (bytes < last.bytes || bytes === last.bytes && node.id >= last.node.id)) {
        omittedBytes += bytes;
        hasOmitted = true;
        continue;
      }
      let low = 0; let high = candidates.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const candidate = candidates[middle]!;
        if (bytes > candidate.bytes || bytes === candidate.bytes && node.id < candidate.node.id) high = middle;
        else low = middle + 1;
      }
      candidates.splice(low, 0, { node, bytes });
      if (candidates.length > boundedChildren) {
        omittedBytes += candidates.pop()!.bytes;
        hasOmitted = true;
      }
    }
    if (!hasOmitted) return candidates.map((candidate) => candidate.node);
    // Reserve the final block for all omitted bytes, including the last
    // candidate. At or below the budget every real child remains visible.
    omittedBytes += candidates.pop()!.bytes;
    const kept = candidates.map((candidate) => candidate.node);
    kept.push({
      id: `\u0000space-preview-other:${parent.id}`,
      name: "Other items",
      path: "",
      kind: "file",
      bytes: omittedBytes,
    });
    return kept;
  };
  const visit = (parent: SpaceNode, x: number, y: number, areaWidth: number, areaHeight: number, depth: 1 | 2) => {
    const children = previewNodes(parent);
    if (!children.length) return;
    const laidOut = layoutNodes(children, areaWidth, areaHeight);
    for (const rect of laidOut) {
      const absolute: SpacePreviewRect = { ...rect, x: x + rect.x, y: y + rect.y, depth };
      result.push(absolute);
      if (depth < maxDepth && rect.node.kind === "folder" && rect.node.children?.length) {
        const inset = 2;
        // Keep a name band on the enclosing folder so its label remains
        // readable above the next level instead of being painted over.
        const titleHeight = rect.width >= 54 && rect.height >= 36 ? 17 : inset;
        visit(rect.node, absolute.x + inset, absolute.y + titleHeight, Math.max(0, absolute.width - inset * 2), Math.max(0, absolute.height - titleHeight - inset), 2);
      }
    }
  };
  visit(root, 0, 0, width, height, 1);
  return result;
}

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
