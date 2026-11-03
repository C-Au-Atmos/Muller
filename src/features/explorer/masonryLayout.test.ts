import { describe, expect, it } from "vitest";

import { buildMasonryLayout, masonryNeighbor, visibleMasonryPositions } from "./masonryLayout";

describe("virtual Masonry layout", () => {
  it("uses deterministic shortest-column placement", () => {
    const first = buildMasonryLayout(1_000, 5, 1_200);
    const second = buildMasonryLayout(1_000, 5, 1_200);
    expect(first.items).toEqual(second.items);
    const shortest = Math.min(...first.columnHeights);
    const tallest = Math.max(...first.columnHeights);
    const maximumItem = Math.max(...first.items.map((item) => item.height));
    expect(tallest - shortest).toBeLessThan(maximumItem + 10);
  });

  it("keeps the mounted window bounded for a 100,000-image directory", () => {
    const layout = buildMasonryLayout(100_000, 5, 1_200);
    const positions = visibleMasonryPositions(layout, layout.height / 2, 900);
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length).toBeLessThan(150);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it.each([0, 74, 109, 110, 229, 230, 469, 470, 633.375, 1_017.5])(
    "fits complete equal-width columns inside a %s-pixel pane",
    (width) => {
      const layout = buildMasonryLayout(120, 5, width);
      expect(layout.columns.length).toBeLessThanOrEqual(5);
      expect(layout.items.every((item) => item.x >= 0 && item.width >= 0)).toBe(true);
      for (const item of layout.items) {
        expect(item.x + item.width).toBeLessThanOrEqual(width + 1e-9);
        expect(item.width).toBe(layout.items[0]?.width);
      }
      expect(Math.max(...layout.items.map((item) => item.x + item.width))).toBeCloseTo(width, 8);
    },
  );

  it("has no negative scroll extent for an empty directory", () => {
    expect(buildMasonryLayout(0, 4, 800).height).toBe(0);
  });

  it("navigates by visual columns instead of array order", () => {
    const layout = buildMasonryLayout(30, 4, 650);
    const current = layout.columns[1]?.[2];
    expect(current).toBeDefined();
    if (!current) return;
    expect(masonryNeighbor(layout, current.position, "up")).toBe(layout.columns[1]?.[1]?.position);
    expect(masonryNeighbor(layout, current.position, "down")).toBe(layout.columns[1]?.[3]?.position);
    expect(layout.columns[0]?.some((item) => item.position === masonryNeighbor(layout, current.position, "left"))).toBe(true);
    expect(layout.columns[2]?.some((item) => item.position === masonryNeighbor(layout, current.position, "right"))).toBe(true);
  });
});
