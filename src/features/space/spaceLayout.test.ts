import { describe, expect, it } from "vitest";

import { buildSpaceMapLayout, buildSpacePreviewLayout, findDirectionalSpaceRect, interpolateSpaceRects, layoutNodes, selectLargestSpaceFolders, spaceNodeBytes, type SpaceRect } from "./spaceLayout";

const node = (id: string, bytes: number) => ({ id, name: id, path: id, kind: "folder" as const, bytes });
const rect = (id: string, x: number, y: number, width: number, height: number): SpaceRect => ({ node: node(id, width * height), x, y, width, height });

describe("layoutNodes", () => {
  it("lays out large child lists without overlap or quadratic work", () => {
    const children = Array.from({ length: 10_000 }, (_, index) => node(String(index), index + 1));
    const started = performance.now();
    const rects = layoutNodes(children, 1200, 800);
    const elapsed = performance.now() - started;

    expect(rects).toHaveLength(children.length);
    expect(rects.every((rect) => rect.width >= 0 && rect.height >= 0)).toBe(true);
    // A generous ceiling catches accidental O(n²) regressions without making
    // the test dependent on a particular machine's exact benchmark speed.
    expect(elapsed).toBeLessThan(500);
  });

  it("preserves total area and returns no rectangles for zero sized nodes", () => {
    const rects = layoutNodes([node("a", 3), node("b", 2), node("empty", 0)], 100, 50);
    expect(rects).toHaveLength(2);
    expect(rects.reduce((sum, rect) => sum + rect.width * rect.height, 0)).toBeCloseTo(5000, 5);
    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const a = rects[left]!;
        const b = rects[right]!;
        const overlaps = a.x < b.x + b.width - 1e-9 && a.x + a.width > b.x + 1e-9
          && a.y < b.y + b.height - 1e-9 && a.y + a.height > b.y + 1e-9;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("makes comparable folders compact instead of stacking them into long strips", () => {
    for (const [width, height] of [[1200, 600], [600, 1200], [800, 800]]) {
      const rects = layoutNodes(Array.from({ length: 15 }, (_, index) => node(String(index), 100)), width!, height!);
      expect(rects).toHaveLength(15);
      expect(Math.max(...rects.map((rect) => Math.max(rect.width / rect.height, rect.height / rect.width)))).toBeLessThan(3);
    }
  });

  it("preserves every weight and stays inside the viewport for skewed data", () => {
    const children = [node("large", 9_000_000), ...Array.from({ length: 70 }, (_, index) => node(String(index), (index + 1) ** 3))];
    const total = children.reduce((sum, item) => sum + item.bytes, 0);
    const rects = layoutNodes(children, 1100, 640);
    for (const rect of rects) {
      expect(rect.width * rect.height / (1100 * 640)).toBeCloseTo(spaceNodeBytes(rect.node) / total, 10);
      expect(rect.x).toBeGreaterThanOrEqual(-1e-8); expect(rect.y).toBeGreaterThanOrEqual(-1e-8);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1100 + 1e-8); expect(rect.y + rect.height).toBeLessThanOrEqual(640 + 1e-8);
    }
  });

  it("gives tied weights deterministic identities regardless of input order", () => {
    const children = [node("b", 2), node("a", 2), node("c", 1)];
    expect(layoutNodes(children, 800, 500)).toEqual(layoutNodes([...children].reverse(), 800, 500));
    expect(children.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("aggregates tiny entries at their actual combined area and retains empty entries in the list", () => {
    const children = [node("large", 1_000_000), node("empty", 0), ...Array.from({ length: 1000 }, (_, index) => node(String(index), 1))];
    const result = buildSpaceMapLayout(children, 1000, 600, "root");
    expect(result.grouped).toHaveLength(1001);
    const aggregate = result.rects.find((rect) => rect.members);
    expect(aggregate?.members).toHaveLength(1001);
    expect(aggregate!.width * aggregate!.height / 600_000).toBeCloseTo(1000 / 1_001_000, 10);
    expect(result.rects.reduce((sum, rect) => sum + rect.width * rect.height, 0)).toBeCloseTo(600_000, 6);
    expect(buildSpaceMapLayout([node("empty", 0)], 1000, 600, "root")).toMatchObject({ rects: [], grouped: [node("empty", 0)] });
  });

  it("bounds visible blocks without losing any represented bytes", () => {
    const children = Array.from({ length: 20_000 }, (_, index) => node(String(index), index + 1));
    const { rects, grouped } = buildSpaceMapLayout(children, 4000, 3000, "root");
    expect(rects.length).toBeLessThanOrEqual(320);
    expect(rects.filter((rect) => !rect.members).every((rect) => Math.min(rect.width, rect.height) >= 28 && rect.width * rect.height >= 1600)).toBe(true);
    expect(grouped.length).toBeGreaterThan(0);
    expect(rects.reduce((sum, rect) => sum + spaceNodeBytes(rect.node), 0)).toBe(children.reduce((sum, item) => sum + item.bytes, 0));
  });

  it("rechecks the final clickable dimensions after aggregates change the packing", () => {
    for (const [width, height] of [[480, 280], [780, 340], [180, 700]]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const children = Array.from({ length: 180 }, (_, index) => node(String(index), 1 + ((index * 7919 + seed * 97) % 300) ** 3));
        const { rects } = buildSpaceMapLayout(children, width!, height!, "root");
        for (const rect of rects.filter((item) => !item.members)) {
          expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(28);
          expect(rect.width * rect.height).toBeGreaterThanOrEqual(1600);
        }
      }
    }
  });

  it("interpolates by identity from the current frame and reaches the exact final layout", () => {
    const first = layoutNodes([node("a", 8), node("b", 2)], 1000, 600);
    const next = layoutNodes([node("a", 8), node("b", 7), node("new", 2)], 1000, 600);
    const previous = new Map(first.map((rect) => [rect.node.id, rect]));
    const halfway = interpolateSpaceRects(previous, next, .5);
    for (const rect of halfway) {
      const target = next.find((item) => item.node.id === rect.node.id)!;
      const source = previous.get(rect.node.id);
      expect(rect.width).toBeCloseTo(((source?.width ?? 0) + target.width) / 2, 8);
      if (source) expect(rect.x).toBeCloseTo((source.x + target.x) / 2, 8);
    }
    expect(interpolateSpaceRects(previous, next, 1)).toEqual(next);
  });

  it("selects the largest folders deterministically and clamps the configured count", () => {
    const folders = [
      { ...node("z", 8), kind: "folder" as const },
      { ...node("a", 8), kind: "folder" as const },
      { ...node("file", 99), kind: "file" as const },
      { ...node("small", 1), kind: "folder" as const },
    ];
    expect(selectLargestSpaceFolders(folders, 0).map((item) => item.id)).toEqual(["a"]);
    expect(selectLargestSpaceFolders(folders, 3).map((item) => item.id)).toEqual(["a", "z", "small"]);
    expect(selectLargestSpaceFolders(folders, 99)).toHaveLength(3);
  });

  it("builds a bounded two-level thumbnail without changing interactive layout", () => {
    const root = {
      ...node("root", 100),
      children: [
        { ...node("folder-a", 70), children: [node("a-file", 40), { ...node("a-folder", 30), children: [node("a-deep", 30)] }] },
        node("root-file", 30),
      ],
    };
    const preview = buildSpacePreviewLayout(root.children[0]!, 200, 100, 2);
    expect(preview.filter((rect) => rect.depth === 1).map((rect) => rect.node.id)).toEqual(["a-file", "a-folder"]);
    expect(preview.filter((rect) => rect.depth === 2).map((rect) => rect.node.id)).toContain("a-deep");
    expect(preview.every((rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 200 && rect.y + rect.height <= 100)).toBe(true);
  });

  it("limits thumbnail work and preserves combined bytes for omitted children", () => {
    const root = { ...node("root", 2000), children: Array.from({ length: 2000 }, (_, index) => node(`child-${index}`, 1)) };
    const preview = buildSpacePreviewLayout(root, 800, 500, 2);
    expect(preview).toHaveLength(24);
    expect(preview.reduce((sum, rect) => sum + spaceNodeBytes(rect.node), 0)).toBe(2000);
    expect(preview.find((rect) => rect.node.id.startsWith("\u0000space-preview-other:"))?.node.bytes).toBe(1977);
    expect(buildSpacePreviewLayout(root, Infinity, 500, 2)).toEqual([]);
  });

  it("keeps all thumbnail children through the budget and orders tied survivors independently of input order", () => {
    for (const count of [23, 24, 25, 80]) {
      const children = Array.from({ length: count }, (_, index) => node(`child-${String(index).padStart(3, "0")}`, 1 + index % 7));
      const bytes = children.reduce((sum, item) => sum + item.bytes, 0);
      const root = { ...node("root", bytes), children };
      const preview = buildSpacePreviewLayout(root, 800, 500, 2);
      const reversed = buildSpacePreviewLayout({ ...root, children: [...children].reverse() }, 800, 500, 2);
      expect(preview).toEqual(reversed);
      const survivors = preview.filter((rect) => !rect.node.id.startsWith("\u0000space-preview-other:"));
      const expected = [...children].sort((left, right) => right.bytes - left.bytes || (left.id < right.id ? -1 : 1)).slice(0, count <= 24 ? count : 23);
      expect(survivors.map((rect) => rect.node.id)).toEqual(expected.map((item) => item.id));
      expect(preview.reduce((sum, rect) => sum + spaceNodeBytes(rect.node), 0)).toBe(bytes);
      expect(preview.some((rect) => rect.node.id.startsWith("\u0000space-preview-other:"))).toBe(count > 24);
      expect(children[0]?.id).toBe("child-000");
    }
  });

  it("selects thumbnail candidates from 100k children with a linear weight-read budget", () => {
    const count = 100_000;
    let weightReads = 0;
    const children = Array.from({ length: count }, (_, index) => {
      const bytes = 1 + index * 7919 % 100_003;
      return { id: String(index), name: String(index), path: String(index), kind: "file" as const,
        get bytes() { weightReads += 1; return bytes; } };
    });
    const preview = buildSpacePreviewLayout({ ...node("root", 1), children }, 1000, 700, 2);
    // Reading each source once plus the bounded final layout is linear. A
    // full comparator sort repeatedly reads weights and exceeds this budget.
    expect(weightReads).toBeLessThan(count * 2);
    expect(preview).toHaveLength(24);
    const expected = Array.from({ length: count }, (_, index) => ({ id: String(index), bytes: 1 + index * 7919 % 100_003 }))
      .sort((left, right) => right.bytes - left.bytes || (left.id < right.id ? -1 : 1));
    const survivors = preview.filter((rect) => !rect.node.id.startsWith("\u0000space-preview-other:"));
    expect(survivors.map((rect) => rect.node.id)).toEqual(expected.slice(0, 23).map((item) => item.id));
    expect(preview.reduce((sum, rect) => sum + spaceNodeBytes(rect.node), 0)).toBe(expected.reduce((sum, item) => sum + item.bytes, 0));
  });
});

describe("findDirectionalSpaceRect", () => {
  it("follows the overlapping visual row before a nearer diagonal tile", () => {
    const source = rect("source", 0, 0, 100, 100);
    const aligned = rect("aligned", 100, 30, 70, 40);
    const diagonal = rect("diagonal", 102, 130, 70, 40);
    expect(findDirectionalSpaceRect([source, diagonal, aligned], source.node, "right")?.node.id).toBe("aligned");
  });

  it("uses edge distance and stable identity when several tiles share a projection", () => {
    const source = rect("source", 0, 0, 100, 100);
    const farther = rect("farther", 140, 10, 40, 40);
    const nearer = rect("nearer", 100, 55, 40, 40);
    expect(findDirectionalSpaceRect([source, farther, nearer], source.node, "right")?.node.id).toBe("nearer");
  });

  it("uses the same projection rule for up and down", () => {
    const source = rect("source", 100, 100, 100, 100);
    const alignedUp = rect("aligned-up", 120, 0, 50, 100);
    const diagonalUp = rect("diagonal-up", 0, 5, 80, 80);
    const alignedDown = rect("aligned-down", 130, 200, 60, 100);
    const diagonalDown = rect("diagonal-down", 230, 205, 80, 80);
    expect(findDirectionalSpaceRect([source, diagonalUp, alignedUp], source.node, "up")?.node.id).toBe("aligned-up");
    expect(findDirectionalSpaceRect([source, diagonalDown, alignedDown], source.node, "down")?.node.id).toBe("aligned-down");
  });

  it("resolves a grouped member to its aggregate rectangle", () => {
    const member = node("member", 10);
    const source: SpaceRect = { ...rect("other", 0, 0, 100, 100), members: [member] };
    const candidate = rect("candidate", 100, 0, 100, 100);
    expect(findDirectionalSpaceRect([source, candidate], member, "right")?.node.id).toBe("candidate");
  });

  it("does not wrap to another tile when no tile exists in that direction", () => {
    const source = rect("source", 0, 0, 100, 100);
    const below = rect("below", 0, 100, 100, 100);
    expect(findDirectionalSpaceRect([source, below], source.node, "left")).toBeUndefined();
  });
});
