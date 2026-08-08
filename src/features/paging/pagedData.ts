export function mergePage<T>(
  current: ReadonlyMap<number, T>,
  offset: number,
  items: readonly T[],
): ReadonlyMap<number, T> {
  const merged = new Map(current);
  items.forEach((item, index) => merged.set(offset + index, item));
  return merged;
}

export function pagesForRange(start: number, end: number, pageSize: number): number[] {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const first = Math.floor(Math.max(0, start) / safePageSize);
  const last = Math.floor(Math.max(0, end - 1) / safePageSize);
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

export function isPageLoaded<T>(
  entries: ReadonlyMap<number, T>,
  page: number,
  pageSize: number,
): boolean {
  return entries.has(page * pageSize);
}
