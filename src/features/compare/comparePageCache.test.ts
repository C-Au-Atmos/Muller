import { describe, expect, it } from "vitest";

import { MAX_COMPARE_PAGES, retainComparePage } from "./comparePageCache";

describe("comparison page retention", () => {
  it("bounds retained data over repeated large-result navigation and reloads evicted pages exactly", () => {
    let entries: ReadonlyMap<number, number> = new Map();
    const pageSize = 128;
    for (let page = 0; page < 200; page += 1) {
      const offset = page * pageSize;
      entries = retainComparePage(entries, offset, Array.from({ length: pageSize }, (_, index) => offset + index), pageSize);
      expect(entries.size).toBeLessThanOrEqual(MAX_COMPARE_PAGES * pageSize);
    }
    expect(entries.has(0)).toBe(false);
    entries = retainComparePage(entries, 0, Array.from({ length: pageSize }, (_, index) => index), pageSize);
    expect(entries.get(127)).toBe(127);
    expect(entries.has(192 * pageSize)).toBe(false);
    expect(entries.size).toBe(MAX_COMPARE_PAGES * pageSize);
  });
});
