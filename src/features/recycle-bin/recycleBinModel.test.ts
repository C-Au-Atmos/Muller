import { describe, expect, it } from "vitest";
import type { RecycleBinEntry } from "./recycleBinClient";
import { recycleEntries, selectRecycleRange } from "./recycleBinModel";

const entry = (name: string, values: Partial<RecycleBinEntry> = {}): RecycleBinEntry => ({ id: name, name, originalPath: `D:\\old\\${name}`, originalParent: "D:\\old", kind: "file", size: 10, deletedMs: 1, typeLabel: "File", ...values });

describe("Recycle Bin listing", () => {
  it("sorts numeric names naturally, filters original location, and retains duplicate names", () => {
    const entries = [entry("10.zip"), entry("2.zip"), entry("2.zip", { id: "duplicate", originalParent: "D:\\Music" })];
    expect(recycleEntries(entries, "", "name", false).map((item) => item.name)).toEqual(["2.zip", "2.zip", "10.zip"]);
    expect(recycleEntries(entries, "music", "name", false).map((item) => item.id)).toEqual(["duplicate"]);
    expect(entries[0]!.name).toBe("10.zip");
  });
  it("sorts dates and sizes with unknown values last in both directions", () => {
    const entries = [entry("missing", { size: null }), entry("a", { size: 2 }), entry("b", { size: 10 })];
    expect(recycleEntries(entries, "", "size", true).map((item) => item.name)).toEqual(["b", "a", "missing"]);
    expect(recycleEntries(entries, "", "size", false).map((item) => item.name)).toEqual(["a", "b", "missing"]);
  });
  it("selects ranges across page boundaries and preserves only additive selections", () => {
    const entries = Array.from({ length: 205 }, (_, index) => entry(String(index)));
    expect(selectRecycleRange(entries, "98", "102", new Set(["1"]), false)).toEqual(new Set(["98", "99", "100", "101", "102"]));
    expect(selectRecycleRange(entries, "102", "98", new Set(["1"]), true)).toEqual(new Set(["1", "98", "99", "100", "101", "102"]));
    expect(selectRecycleRange(entries, "gone", "102", new Set(), false)).toEqual(new Set(["102"]));
  });
});
