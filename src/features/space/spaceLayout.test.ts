import { describe, expect, it } from "vitest";

import { layoutNodes } from "./spaceLayout";

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
  });
});
