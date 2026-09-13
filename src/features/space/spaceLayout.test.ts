import { describe, expect, it } from "vitest";

import { buildSpaceMapLayout, interpolateSpaceRects, layoutNodes, spaceNodeBytes } from "./spaceLayout";

const node = (id: string, bytes: number) => ({ id, name: id, path: id, kind: "folder" as const, bytes });

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
});
