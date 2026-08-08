import { describe, expect, it } from "vitest";

import { isPageLoaded, mergePage, pagesForRange } from "./pagedData";

describe("paged data model", () => {
  it("maps a response offset without mutating existing pages", () => {
    const original = new Map([[0, "first"]]);
    const merged = mergePage(original, 4, ["fifth", "sixth"]);

    expect(original.size).toBe(1);
    expect([...merged.entries()]).toEqual([
      [0, "first"],
      [4, "fifth"],
      [5, "sixth"],
    ]);
  });

  it("calculates inclusive visible pages at exact boundaries", () => {
    expect(pagesForRange(0, 128, 128)).toEqual([0]);
    expect(pagesForRange(127, 129, 128)).toEqual([0, 1]);
    expect(pagesForRange(-10, 0, 128)).toEqual([0]);
  });

  it("uses the page anchor as the loaded marker", () => {
    expect(isPageLoaded(new Map([[128, "item"]]), 1, 128)).toBe(true);
    expect(isPageLoaded(new Map([[129, "item"]]), 1, 128)).toBe(false);
  });
});
