export const MAX_COMPARE_PAGES = 8;

/** Keep only the most recently read pages; exact results remain in the native session. */
export function retainComparePage<T>(
  current: ReadonlyMap<number, T>,
  offset: number,
  items: readonly T[],
  pageSize: number,
): ReadonlyMap<number, T> {
  const page = Math.floor(offset / pageSize);
  const next = new Map<number, T>();
  for (const [position, item] of current) {
    if (Math.floor(position / pageSize) !== page) next.set(position, item);
  }
  items.forEach((item, index) => next.set(offset + index, item));
  const pages = [...new Set([...next.keys()].map((position) => Math.floor(position / pageSize)))];
  const evicted = new Set(pages.slice(0, Math.max(0, pages.length - MAX_COMPARE_PAGES)));
  for (const position of next.keys()) {
    if (evicted.has(Math.floor(position / pageSize))) next.delete(position);
  }
  return next;
}
