import type { RecycleBinEntry } from "./recycleBinClient";

export const RECYCLE_PAGE_SIZE = 100;
export type RecycleSort = "name" | "originalParent" | "deletedMs" | "size" | "typeLabel";
const nameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function recycleEntries(entries: readonly RecycleBinEntry[], query: string, sort: RecycleSort, descending: boolean): RecycleBinEntry[] {
  return filterRecycleEntries(sortRecycleEntries(entries, sort, descending), query);
}

export function filterRecycleEntries(entries: readonly RecycleBinEntry[], query: string): RecycleBinEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? entries.filter((entry) => `${entry.name}\n${entry.originalParent}`.toLocaleLowerCase().includes(needle)) : [...entries];
}

export function sortRecycleEntries(entries: readonly RecycleBinEntry[], sort: RecycleSort, descending: boolean): RecycleBinEntry[] {
  return [...entries].sort((left, right) => {
    const a = left[sort]; const b = right[sort];
    // Unknown size/time always follows known values, in either direction.
    if (a === null && b !== null) return 1;
    if (b === null && a !== null) return -1;
    const primary = typeof a === "number" && typeof b === "number" ? a - b : nameOrder.compare(String(a ?? ""), String(b ?? ""));
    const stable = nameOrder.compare(left.name, right.name) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    return (descending ? -primary : primary) || stable;
  });
}

export function selectRecycleRange(entries: readonly RecycleBinEntry[], anchor: string | null, target: string, previous: ReadonlySet<string>, additive: boolean): Set<string> {
  const targetIndex = entries.findIndex((entry) => entry.id === target);
  const anchorIndex = entries.findIndex((entry) => entry.id === anchor);
  if (targetIndex < 0) return new Set(previous);
  const start = anchorIndex < 0 ? targetIndex : anchorIndex;
  const next = new Set(additive ? previous : []);
  for (let index = Math.min(start, targetIndex); index <= Math.max(start, targetIndex); index += 1) next.add(entries[index]!.id);
  return next;
}
