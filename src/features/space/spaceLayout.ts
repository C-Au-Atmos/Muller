import type { SpaceNode } from "./types";

export interface SpaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  node: SpaceNode;
}

const bytesOf = (node: SpaceNode): number => {
  const value = node.bytes ?? node.size ?? 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * Build a weighted strip treemap in one pass. Each strip gets a share of the
 * available width based on its byte total, then its children are stacked by
 * byte share. This keeps the layout area accurate while avoiding the O(n²)
 * slice/filter/reduce work that made large directories expensive to render.
 */
export function layoutNodes(nodes: readonly SpaceNode[], width: number, height: number): SpaceRect[] {
  if (width <= 0 || height <= 0 || nodes.length === 0) return [];

  const positive: Array<{ node: SpaceNode; bytes: number }> = [];
  let total = 0;
  for (const node of nodes) {
    const bytes = bytesOf(node);
    if (bytes > 0) {
      positive.push({ node, bytes });
      total += bytes;
    }
  }
  if (positive.length === 0 || total <= 0) return [];

  // The target strip count adapts to viewport aspect ratio. Partitioning is
  // contiguous and greedy, so it remains O(n) and does not allocate slices.
  const targetStrips = Math.max(1, Math.min(positive.length, Math.ceil(Math.sqrt(positive.length * width / height))));
  const rects: SpaceRect[] = [];
  let offset = 0;
  let remainingBytes = total;
  let remainingStrips = targetStrips;

  while (offset < positive.length) {
    const targetBytes = remainingBytes / remainingStrips;
    const start = offset;
    let stripBytes = 0;
    while (offset < positive.length) {
      const item = positive[offset]!;
      const itemsLeft = positive.length - offset;
      const stripsAfter = remainingStrips - 1;
      // Keep at least one item for each remaining strip. Once the current
      // strip is close to target, start the next strip before it grows large.
      if (stripBytes > 0 && stripsAfter > 0 && itemsLeft <= stripsAfter) break;
      if (stripBytes > 0 && stripsAfter > 0 && stripBytes >= targetBytes) break;
      stripBytes += item.bytes;
      offset += 1;
    }
    const stripWidth = width * (stripBytes / total);
    const x = width * ((total - remainingBytes) / total);
    let y = 0;
    for (let index = start; index < offset; index += 1) {
      const item = positive[index]!;
      const itemHeight = height * (item.bytes / stripBytes);
      rects.push({ x, y, width: stripWidth, height: itemHeight, node: item.node });
      y += itemHeight;
    }
    remainingBytes -= stripBytes;
    remainingStrips -= 1;
  }
  return rects;
}

