import { describe, expect, it } from "vitest";

import { revealScrollTarget } from "./scrollReveal";

describe("minimal reveal scrolling", () => {
  it("does not move an already visible item", () => {
    expect(revealScrollTarget(100, 300, 140, 220, 1_000)).toBe(100);
  });

  it("moves only far enough to reveal the nearest clipped edge", () => {
    expect(revealScrollTarget(100, 300, 80, 150, 1_000)).toBe(68);
    expect(revealScrollTarget(100, 300, 360, 440, 1_000)).toBe(152);
  });

  it("clamps against both content edges", () => {
    expect(revealScrollTarget(20, 300, 0, 20, 500)).toBe(0);
    expect(revealScrollTarget(190, 300, 480, 500, 500)).toBe(200);
  });
});

