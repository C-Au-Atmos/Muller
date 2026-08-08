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
